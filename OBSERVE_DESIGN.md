# Distributed System Observability Design Document

## 1. Executive Summary & Architectural Goals

The Healthcare Platform observability subsystem provides unified, low-overhead telemetry across all domain services (e.g., `healthcare-api`, `healthcare-notification-api`). The architecture decouples telemetry ingestion, storage, and querying from transactional business logic while enforcing strict correlation across the three core observability pillars: **Traces**, **Metrics**, and **Logs**.

### Primary Design Goals

- **Single Standard Ingestion:** Standardize on the OpenTelemetry (OTel) protocol across services regardless of underlying runtime.
- **Context Propagation:** Correlate inbound user actions across service boundaries using W3C Trace Context headers (`traceparent`).
- **Cardinality Control:** Safeguard metric store memory by restricting dynamic attributes (user IDs, request IDs, UUIDs) strictly to log metadata and trace span attributes—never Prometheus labels.
- **Pull-Based Metrics, Push-Based Traces/Logs:** Utilize Prometheus scraping via Kubernetes service discovery alongside push-based OTLP pipelines for traces and structured logs.

---

## 2. High-Level Architecture

```text
                                    +-----------------------------------------+
                                    |         User / Web Client / Mobile      |
                                    +--------------------+--------------------+
                                                         |
                                                         | HTTP (x-request-id / traceparent)
                                                         v
                                    +-----------------------------------------+
                                    |              API Gateway                |
                                    +---------+---------------------+---------+
                                              |                     |
                        HTTP / gRPC (W3C Trace Context)             |
                                              |                     |
                                              v                     v
                                  +-------------------+   +--------------------+
                                  |  healthcare-api   |   | healthcare-notif   |
                                  +---------+---------+   +----------+---------+
                                            |                        |
             +------------------------------+                        +------------------------------+
             |                              |                        |                              |
      stdout | (JSON Logs)      OTLP (gRPC) |                 stdout | (JSON Logs)      OTLP (gRPC) |
             v                              v                        v                              v
    +-----------------+           +-------------------+    +-----------------+            +-------------------+
    | Container Engine|           |                   |    | Container Engine|            |                   |
    +--------+--------+           |                   |    +--------+--------+            |                   |
             |                    |                   |             |                     |                   |
             | Log scraping       |  OTel Collector   |             | Log scraping        |  OTel Collector   |
             | (Alloy / Agent)    |  (Daemon / Mesh)  |             | (Alloy / Agent)     |  (Daemon / Mesh)  |
             +------------------->|                   |<------------+-------------------->|                   |
                                  +----+---------+----+                                   +----+---------+----+
                                       |         |                                             |         |
                                       |         | Push                                        |         |
                                       |         +-----------------------+                     |         |
                                       v                                 v                     v         v
                               +---------------+                 +---------------+     +---------------+
                               |  Grafana Loki |                 |  Tempo (OTLP) |     |  Prometheus   |
                               +-------+-------+                 +-------+-------+     +-------+-------+
                                       |                                 |                     ^
                                       |                                 |                     | Pull: /metrics
                                       |                                 +----------+          | (every 15s)
                                       |                                            |          |
                                       v                                            v          v
                               +---------------------------------------------------------------+
                               |                        Grafana UI                             |
                               +---------------------------------------------------------------+
```

---

## 3. The Three Pillars of Observability

### Correlation Matrix

| Pillar   | Pipeline Protocol  | Target Backend | Indexing / Labels   | High-Cardinality?        |
|----------|--------------------|----------------|---------------------|--------------------------|
| Metrics  | HTTP GET /metrics  | Prometheus     | service, env, route | **NO** (Strictly Banned) |
| Logs     | stdout -> OTLP     | Grafana Loki   | service, env, level | YES (Metadata only)      |
| Traces   | OTLP (gRPC 4317)   | Grafana Tempo  | service, span_name  | YES (Span attributes)    |

### 3.1 Distributed Tracing

- **Standard:** W3C Trace Context (`traceparent`, `tracestate`).
- **Instrumentation:** The OpenTelemetry NodeSDK initializes before any framework imports.
- **Span Generation:**
  - Inbound HTTP requests automatically start a server span.
  - Database queries (via TypeORM or Prisma) generate child spans containing normalized SQL statements.
  - Outbound requests or event emissions inject `traceparent` headers into outgoing payloads.

### 3.2 Structured Logging

- **Mechanism:** Applications emit single-line, structured JSON directly to `stdout`.
- **Zero Synchronous Network I/O:** Services never push logs to a network socket synchronously. The underlying container runtime flushes stdout, and a log collector (OTel Collector / Grafana Alloy) forwards entries asynchronously.
- **Canonical Fields Present in Every Log Line:**

```json
{
  "severity": "INFO",
  "time": 1773532800000,
  "service": {
    "name": "healthcare-api",
    "version": "1.2.0"
  },
  "environment": "production",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "spanId": "00f067aa0ba902b7",
  "message": "Appointment booked successfully",
  "appointmentId": "apt-83921",
  "http": {
    "method": "POST",
    "url": "/appointments"
  }
}
```

### 3.3 Metrics Collection

- **Model:** Explicit pull/scrape architecture.
- **Endpoint:** Each service exposes an unauthenticated (or cluster-internal) `/metrics` endpoint on its assigned application port.
- **Scrape Interval:** 15 seconds across production environments.
- **Cardinality Safeguard:**
  - **Allowed metric labels:** `method`, `route` (parameterized, e.g., `/users/:id`), `status_code`, `service_name`, `environment`.
  - **Forbidden metric labels:** `userId`, `patientId`, `appointmentId`, `email`, `traceId`.

---

## 4. Cross-Service Interaction & Context Propagation Flow

When a user initiates an action (e.g., booking an appointment), telemetry links the distributed request cycle across microservices:

```text
+---------------+           +--------------------+           +-------------------------------+
|  Client App   |           |   healthcare-api   |           |  healthcare-notification-api  |
+-------+-------+           +---------+----------+           +---------------+---------------+
        |                             |                                      |
        | 1. POST /appointments       |                                      |
        |    x-request-id: req-001    |                                      |
        +---------------------------->|                                      |
        |                             | 2. Starts root span:                 |
        |                             |    TraceID: 0x4bf9...                |
        |                             |    SpanID:  0x00f0...                |
        |                             |                                      |
        |                             | 3. Inserts row into MySQL            |
        |                             |    (Generates DB child span)         |
        |                             |                                      |
        |                             | 4. Emits notification dispatch event |
        |                             |    Headers: traceparent: 00-4bf9...  |
        |                             +------------------------------------->|
        |                             |                                      | 5. Extracts traceparent
        |                             |                                      |    Starts child span under
        |                             |                                      |    same TraceID: 0x4bf9...
        |                             |                                      |
        |                             |                                      | 6. Sends Push / SMS
        |                             |                                      |    Logs success with:
        |                             |                                      |    traceId=0x4bf9...
        |                             |                                      |    service=notification-api
        | 7. HTTP 201 Created         |                                      |
        |<----------------------------+                                      |
```

- **Context Extraction:** `healthcare-api` extracts the incoming `x-request-id` and initiates a new OpenTelemetry root trace (`traceId: 0x4bf9...`).
- **Local Correlation:** Pino log mixins inject the active `traceId` and `spanId` into all logs produced during the HTTP lifecycle.
- **Context Injection:** When `healthcare-api` calls `healthcare-notification-api` (or pushes a task to a queue), it injects the W3C `traceparent` header (`00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`).
- **Downstream Adoption:** `healthcare-notification-api` receives the request, extracts the `traceparent`, and binds all its subsequent operations, DB queries, and logs to the original `traceId`.
- **Unified Querying:** Searching `traceId: 4bf92f3577b34da6a3ce929d0e0e4736` in Grafana aggregates traces across both services alongside their interleaved logs from Loki.

---

## 5. Polyglot Service Integration Contract

All services in the ecosystem must adhere to the standard integration matrix:

### Language Integration Matrix

| Ecosystem         | Logging              | Metrics                  | Tracing SDK                            |
|-------------------|----------------------|--------------------------|----------------------------------------|
| Node.js / NestJS  | Pino / nestjs-pino   | prom-client (`/metrics`) | `@opentelemetry/sdk-node`              |
| Go                | slog or Uber Zap     | prometheus/client_golang | `go.opentelemetry.io/otel`             |
| Java / Spring     | Logback + Logstash   | Micrometer Prometheus    | `io.opentelemetry:opentelemetry-api`   |
| Python            | structlog            | prometheus_client        | `opentelemetry-sdk`                    |

### Universal Service Requirements

**Health & Metrics Endpoints:**

- `GET /health` (or `/ready`): Returns HTTP 200 when operational.
- `GET /metrics`: Exposes Prometheus-formatted text metrics.

**Environment Variables:**

- `OTEL_EXPORTER_OTLP_ENDPOINT`: URL to OTel Collector (`http://otel-collector.observability.svc.cluster.local:4317`).
- `SERVICE_NAME`: The canonical service registry name (e.g., `healthcare-api`).
- `NODE_ENV` / `ENVIRONMENT`: Target environment (`production`, `staging`, `development`).

---

## 6. Storage, Data Retention, & Lifecycle Management

### Retention Strategy

| Data Type          | Storage Backend      | Retention Period | Compaction / Pruning   |
|--------------------|----------------------|------------------|------------------------|
| Metrics            | Prometheus TSDB      | 30 Days          | Built-in TSDB Blocks   |
| Structured Logs    | Grafana Loki (TSDB)  | 14 Days          | 24h Table Periods      |
| Distributed Traces | Tempo (Object Store) | 7 Days           | Block Retention Sweeps |

- **Loki Partitioning:** Chunks are partitioned every 24 hours. Old chunks drop automatically based on the `reject_old_samples_max_age: 168h` and retention sweeps.
- **Volume Types:** Both Prometheus and Loki run as Kubernetes StatefulSet resources backed by fast SSD-backed block storage (ReadWriteOnce PVCs).

---

## 7. Operational Runbook & Troubleshooting

### Scenario 1: Missing Trace Spans

- **Check:** Verify that `initTracing()` runs on line 1 of the application entry point, before any third-party HTTP modules are loaded.
- **Verification:** Run `kubectl logs <pod-name> -n default` to confirm the OpenTelemetry SDK initialized without gRPC connection drops to port 4317.

### Scenario 2: High Memory on Prometheus Pods

- **Check:** Suspected high cardinality.
- **Mitigation:** Run the following query in Prometheus:

```promql
topk(10, count by (__name__)({__name__=~".+"}))
```

Inspect metric names with excessive series. Ensure no developers registered endpoint routes with raw UUIDs instead of route templates (e.g., ensure `/appointments/:id` is registered, not `/appointments/123e4567-e89b`).

### Scenario 3: Loki Rejecting Log Streams

- **Cause:** Log lines exceeding maximum byte size or timestamps sent out-of-order.
- **Mitigation:** Ensure applications do not dump binary payloads or large base64 strings into log statements. Set `max_line_size: 256kb` in `loki-config.yaml`.

---

## 8. Summary

This observability design ensures that every service in the Healthcare Platform emits telemetry through a **single, standardized, low-overhead pipeline** while preserving the ability to correlate events across service boundaries via W3C Trace Context. The strict cardinality safeguards, retention policies, and polyglot integration matrix make the system scalable, maintainable, and production-ready.