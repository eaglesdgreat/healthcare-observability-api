# System Architecture & Design Document: Healthcare Observability Platform

## 1. Executive Summary & System Overview

The Healthcare Observability Platform is a centralized telemetry system tailored specifically for our Node.js/NestJS microservices ecosystem (`healthcare-api`, `healthcare-notification-api`). Built entirely on Node.js, TypeScript, and NestJS, the system eliminates vendor lock-in by implementing the OpenTelemetry (OTel) standard across all three observability pillars: **Distributed Tracing**, **Metrics Scraping**, and **Structured Log Correlation**.

```text
+------------------------------------------------------------------------------------+
|                                    CORE TOPOLOGY                                   |
+------------------------------------------------------------------------------------+
|                                                                                    |
|   +--------------------------+               +---------------------------------+   |
|   |  healthcare-api (NestJS) |               | healthcare-notification (NestJS)|   |
|   |  - TypeORM on MySQL      |               | - Prisma on MySQL               |   |
|   |  - OTel NodeSDK + Pino   |               | - OTel NodeSDK + Pino           |   |
|   +------------+-------------+               +----------------+----------------+   |
|                |                                              |                    |
|                | OTLP/gRPC (4317)                             | OTLP/gRPC (4317)   |
|                | Pull: /metrics (5501)                        | Pull: /metrics     |
|                | stdout (JSON Logs)                           | stdout (JSON Logs) |
|                +-----------------------+----------------------+                    |
|                                        |                                           |
|                                        v                                           |
|                      +----------------------------------+                          |
|                      |  OpenTelemetry Collector Cluster |                          |
|                      |  (Receivers, Batch, Filters)     |                          |
|                      +----+-------------+------------+--+                          |
|                           |             |            |                             |
|              Push Logs    |             | Push Traces| Scrape /metrics             |
|              (HTTP 3100)  |             | (gRPC 4317)| (HTTP 9090)                 |
|                           v             v            v                             |
|                     +-----------+ +-----------+ +------------+                     |
|                     |   Loki    | |   Tempo   | | Prometheus |                     |
|                     +-----+-----+ +-----+-----+ +-----+------+                     |
|                           |             |             |                            |
|                           +-------------+-------------+                            |
|                                         |                                          |
|                                         v                                          |
|                              +---------------------+                               |
|                              |     Grafana OSS     |                               |
|                              | (Unified Dashboards)|                               |
|                              +---------------------+                               |
+------------------------------------------------------------------------------------+
```

### Architectural Guarantees

- **Strict Trace Propagation:** W3C `traceparent` headers link NestJS HTTP, event emitter, and message queue contexts across services.
- **Bounded Cardinality:** Metrics are strictly pull-based using static route templates (`/appointments/:id`), completely omitting dynamic entities (`userId`, `appointmentId`) from Prometheus label sets.
- **Low-Overhead Logging:** Non-blocking asynchronous JSON log writing to `stdout` with automatic correlation injection (`traceId`, `spanId`).

---

## 2. Shared NestJS Observability Architecture

To ensure uniformity across all services without copy-pasting instrumentation logic, a shared internal workspace package (`@healthcare/nestjs-observability`) is integrated directly into the NestJS runtime.

```text
                  NESTJS SERVICE INITIALIZATION SEQUENCE

    [process.main()]
           |
           v
    +-----------------------------------------------+
    | 1. initTracing(serviceName)                   |
    |    - Bootstraps OTel NodeSDK                  |
    |    - Injects HttpInstrumentation              |
    |    - Injects ExpressInstrumentation           |
    |    - Injects MySQL2 / TypeORM / Prisma Hooks  |
    +-----------------------+-----------------------+
                            |
                            v
    +-----------------------------------------------+
    | 2. NestFactory.create(AppModule)              |
    |    - Registers AppObservabilityModule         |
    |    - Mounts PinoLogger middleware             |
    |    - Configures metrics interceptor           |
    +-----------------------+-----------------------+
                            |
                            v
    +-----------------------------------------------+
    | 3. Application Lifecycle                      |
    |    - Intercepts requests & extracts contexts  |
    |    - Exposes GET /metrics on service port     |
    +-----------------------------------------------+
```

### 2.1 OpenTelemetry Bootstrapper (`src/tracing/sdk.ts`)

Must execute **before** any database drivers, Express, or NestJS modules are imported into memory:

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

export function bootstrapTelemetry(serviceName: string, serviceVersion: string = '1.0.0') {
  const exporter = new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://otel-collector.observability.svc.cluster.local:4317',
  });

  const sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
      'deployment.environment': process.env.NODE_ENV || 'production',
    }),
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false }, // suppress noisy file reads
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  });

  sdk.start();

  process.on('SIGTERM', () => {
    sdk.shutdown().finally(() => process.exit(0));
  });
}
```

### 2.2 Structured Pino Logger Module (`src/logger/logger.module.ts`)

Injects the active OpenTelemetry context into the JSON payload emitted to `stdout`.

```typescript
import { DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { trace, context } from '@opentelemetry/api';

@Module({})
export class AppObservabilityLoggerModule {
  static forRoot(serviceName: string): DynamicModule {
    return LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL || 'info',
        base: {
          service: { name: serviceName, version: process.env.npm_package_version || '1.0.0' },
          env: process.env.NODE_ENV || 'production',
        },
        messageKey: 'message',
        formatters: {
          level: (label) => ({ severity: label.toUpperCase() }),
        },
        mixin: () => {
          const activeSpan = trace.getSpan(context.active());
          if (!activeSpan) return {};
          const spanContext = activeSpan.spanContext();
          return {
            traceId: spanContext.traceId,
            spanId: spanContext.spanId,
            traceFlags: spanContext.traceFlags,
          };
        },
      },
    });
  }
}
```

### 2.3 Metrics Interceptor & Exposer (`src/metrics/metrics.controller.ts`)

Maintains the pull model by serving Prometheus-compliant metrics over `/metrics` with standardized labels.

```typescript
import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { register, collectDefaultMetrics, Counter, Histogram } from 'prom-client';

collectDefaultMetrics({ prefix: 'healthcare_' });

export const httpRequestDuration = new Histogram({
  name: 'healthcare_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
});

export const httpRequestsTotal = new Counter({
  name: 'healthcare_http_requests_total',
  help: 'Total count of HTTP requests handled',
  labelNames: ['method', 'route', 'status_code'],
});

@Controller('metrics')
export class MetricsController {
  @Get()
  async getMetrics(@Res() res: Response) {
    res.setHeader('Content-Type', register.contentType);
    res.send(await register.metrics());
  }
}
```

---

## 3. Distributed Tracing & Inter-Service Correlation

When a patient books an appointment in `healthcare-api`, triggering an alert dispatch via `healthcare-notification-api`, context is preserved end-to-end via W3C `traceparent` headers.

```text
       [healthcare-api]                            [healthcare-notification-api]
 (TypeORM Engine on MySQL)                              (Prisma Engine on MySQL)
            |                                                      |
            | 1. POST /appointments                                |
            |    (Start Root Span: 0x8af4...)                      |
            +--------------------------------+                     |
            | 2. DB Transaction (TypeORM)    |                     |
            |    (Child Span: 0x1b2c...)     |                     |
            +--------------------------------+                     |
            |                                                      |
            | 3. POST /notifications/dispatch                      |
            |    Headers: traceparent=00-8af4...-3d4f...-01        |
            +----------------------------------------------------->|
                                                                   | 4. Extract parent context
                                                                   |    (Child Span: 0x9e8a...)
                                                                   +--------------------------------+
                                                                   | 5. DB Persistence (Prisma)     |
                                                                   |    (Child Span: 0x7a6d...)     |
                                                                   +--------------------------------+
                                                                   | 6. Dispatch Email/SMS          |
                                                                   |    (Log JSON with traceId)     |
                                                                   +--------------------------------+
```

### Data Pipeline Matrix

| Pillar  | Collection Mechanism       | Pipeline Protocol              | Target Ingestor          | Indexing Rules                                                          |
|---------|----------------------------|--------------------------------|--------------------------|-------------------------------------------------------------------------|
| Traces  | In-app OTel NodeSDK        | OTLP via gRPC (port 4317)      | OTel Collector → Tempo   | Low-cardinality span names, high-cardinality tags in span attributes    |
| Metrics | Pull scraping via HTTP     | PromQL text format (`/metrics`) | Prometheus (port 9090)   | Label sets limited to `method`, `route`, `status_code`, `env`           |
| Logs    | Node.js `stdout`           | JSON Lines collected via OTel/Alloy | Grafana Loki (port 3100) | Indexed labels: `service`, `env`, `severity`. IDs are structured metadata |

---

## 4. Infrastructure Specifications & Configurations

### 4.1 OpenTelemetry Collector Pipeline (`otel-collector-config.yaml`)

Processes traces and forwards logs to Loki while gathering collector runtime metrics.

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  memory_limiter:
    check_interval: 1s
    limit_percentage: 75
    spike_limit_percentage: 20
  batch:
    timeout: 1s
    send_batch_size: 512

exporters:
  loki:
    endpoint: http://loki.observability.svc.cluster.local:3100/loki/api/v1/push
    default_labels_enabled:
      exporter: false
      job: true
      instance: false

  prometheus:
    endpoint: 0.0.0.0:8889
    namespace: "otel"

  otlp/tempo:
    endpoint: tempo.observability.svc.cluster.local:4317
    tls:
      insecure: true

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp/tempo]
    logs:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [loki]
```

### 4.2 Loki TSDB Storage Configuration (`loki-config.yaml`)

Configured to handle dynamic fields as **structured metadata** rather than indexing them into streams, which prevents out-of-memory errors.

```yaml
auth_enabled: false

server:
  http_listen_port: 3100
  grpc_listen_port: 9096

common:
  path_prefix: /loki
  storage:
    filesystem:
      chunks_directory: /loki/chunks
      rules_directory: /loki/rules
  replication_factor: 1
  ring:
    kvstore:
      store: inmemory

schema_config:
  configs:
    - from: 2024-01-01
      store: tsdb
      object_store: filesystem
      schema: v13
      index:
        prefix: index_
        period: 24h

limits_config:
  allow_structured_metadata: true
  reject_old_samples: true
  reject_old_samples_max_age: 168h
  max_line_size: 256kb
```

### 4.3 Prometheus Pull Scraping (`prometheus.yml`)

Configured for Kubernetes pod auto-discovery. Any NestJS pod annotated with `prometheus.io/scrape: "true"` is registered automatically.

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: "otel-collector"
    static_configs:
      - targets: ["otel-collector.observability.svc.cluster.local:8889"]

  - job_name: "kubernetes-pods"
    kubernetes_sd_configs:
      - role: pod
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
        action: keep
        regex: true
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_path]
        action: replace
        target_label: __metrics_path__
        regex: (.+)
      - source_labels: [__address__, __meta_kubernetes_pod_annotation_prometheus_io_port]
        action: replace
        regex: ([^:]+)(?::\d+)?;(\d+)
        replacement: $1:$2
        target_label: __address__
      - source_labels: [__meta_kubernetes_namespace]
        action: replace
        target_label: namespace
      - source_labels: [__meta_kubernetes_pod_label_app_kubernetes_io_name]
        action: replace
        target_label: service_name
```

---

## 5. Kubernetes Deployment Manifests

The observability stack runs within its own namespace (`observability`) as a combination of multi-replica deployments and stateful sets backed by PersistentVolumeClaims.

```text
               KUBERNETES DEPLOYMENT BOUNDARIES

 [Namespace: default]                      [Namespace: observability]
+-------------------------------+         +-------------------------------------+
| Pod: healthcare-api           |         | Deployment: otel-collector          |
|  - Ports: 5501 (HTTP)         | OTLP    |  - Replicas: 2                      |
|  - Annotations:               +-------->|  - Ports: 4317 (gRPC), 8889 (Prom)  |
|      prometheus.io/scrape=true|         +------+------------------+-----------+
|                               |                |                  |
| Pod: healthcare-notification  |                | Push Logs        | Push Traces
|  - Ports: 5502 (HTTP)         |                v                  v
|  - Annotations:               |         +--------------+   +------------------+
|      prometheus.io/scrape=true|         | StatefulSet: |   | StatefulSet:     |
+---------------+---------------+         | Loki         |   | Tempo            |
                |                         | - PVC: 100Gi |   | - PVC: 50Gi      |
                | Pull Scrape             +--------------+   +------------------+
                v                                |                     |
+-------------------------------+                | Data Source         | Data Source
| StatefulSet: Prometheus       |                v                     v
|  - Replicas: 1                +-------->+-------------------------------------+
|  - PVC: 100Gi                 |         | Deployment: Grafana                 |
|  - RBAC: Node/Pod Explorer    |         |  - Dashboards & Trace Viewer        |
+-------------------------------+         +-------------------------------------+
```

### 5.1 Resource Requests & Limits Allocation

| Service        | Kind                     | Storage         | CPU Req / Limit | Memory Req / Limit |
|----------------|--------------------------|-----------------|-----------------|--------------------|
| OTel Collector | Deployment (2 replicas)  | None (Stateless)| 250m / 1000m    | 512Mi / 1Gi        |
| Prometheus     | StatefulSet (1 replica)  | 100Gi (GP3/SSD) | 500m / 2000m    | 2Gi / 8Gi          |
| Loki           | StatefulSet (1 replica)  | 100Gi (GP3/SSD) | 500m / 2000m    | 1Gi / 4Gi          |
| Grafana        | Deployment (1 replica)   | 10Gi (Config)   | 100m / 500m     | 256Mi / 1Gi        |

---

## 6. Verification, Health Checks, & CI/CD Pipeline

To ensure deployments maintain observability compliance, all pull requests across `healthcare-api` and `healthcare-notification-api` run continuous validation checks:

```text
[PR Trigger] -> [pnpm test:unit] -> [pnpm test:integration] -> [pnpm test:e2e] -> [Container Smoke Test]
                                                                                        |
                                                               +------------------------+
                                                               |
                                                               v
                                                - Start service container
                                                - Await HTTP 200 on /health
                                                - Verify GET /metrics returns:
                                                  * healthcare_http_requests_total
                                                  * process_cpu_user_seconds_total
                                                - Validate JSON stdout log structure
```

### Local Development Smoke Check

Developers can verify telemetry locally using the project's root `Makefile`:

```bash
# Spin up the local observability infrastructure
docker compose -f docker-compose.observability.yml up -d

# Verify metrics endpoint on healthcare-api
curl -s http://127.0.0.1:5501/metrics | grep healthcare_http_requests_total

# Inspect correlated trace in stdout
curl -X POST http://127.0.0.1:5501/appointments \
  -H "Content-Type: application/json" \
  -d '{"doctorId":"doc-1","slot":"2026-10-01T09:00:00Z"}'
```