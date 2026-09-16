# Healthcare Observability Platform (`healthcare-observability`)

Centralized observability infrastructure and shared NestJS telemetry libraries for the healthcare microservices ecosystem (`healthcare-api`, `healthcare-notification-api`). This platform standardizes **Distributed Tracing (OpenTelemetry)**, **Metrics (Prometheus)**, and **Structured Logging (Pino + Grafana Loki)** across all services.

---

## Repository Structure

```text
healthcare-observability/
├── packages/
│   └── nestjs-observability/       # Shared NestJS module (tracing, logging, metrics)
│       ├── src/
│       ├── package.json
│       └── tsconfig.json
├── infra/
│   ├── otel-collector/             # OpenTelemetry Collector pipelines
│   ├── prometheus/                 # Prometheus scrape configs & alert rules
│   ├── loki/                       # Grafana Loki TSDB schema configs
│   ├── grafana/                    # Provisioned datasources & pre-built dashboards
│   └── k8s/                        # Production Kubernetes manifests
├── docker-compose.observability.yml # Local telemetry stack (Collector, Prometheus, Loki, Grafana)
├── Makefile                        # Automation recipes for local dev & testing
└── README.md
```

---

## Prerequisites & Required Packages

### System Tools

- **Node.js**: `v24.x` (LTS)
- **pnpm**: `v9.x` or `v10.x` (`corepack enable && corepack use pnpm@latest`)
- **Docker & Docker Compose**: Engine `24.x+`, Compose `v2.x+`
- **Make**: GNU Make

### Core Packages (`packages/nestjs-observability`)

- **Tracing**: `@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/exporter-trace-otlp-grpc`, `@opentelemetry/api`, `@opentelemetry/resources`, `@opentelemetry/semantic-conventions`
- **Logging**: `nestjs-pino`, `pino`, `pino-http`
- **Metrics**: `prom-client`

---

## Quickstart: Local Environment Setup

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/eaglesdgreat/healthcare-observability.git
cd healthcare-observability

# Install dependencies across all packages using pnpm workspace
pnpm install --frozen-lockfile
```

### 2. Build the Shared NestJS Library

```bash
# Compile TypeScript library to dist/
pnpm --filter @healthcare/nestjs-observability run build
```

---

## Running the Observability Stack

### Option A: Local Containerized Telemetry Stack (Docker Compose)

Spin up OpenTelemetry Collector, Prometheus, Loki, and Grafana:

```bash
# Start all observability components in background
make obs-up

# Or via direct docker command:
docker compose -f docker-compose.observability.yml up -d
```

#### Exposed Ports & Access Points

| Service | Port | Endpoint / Purpose | Credentials |
| --- | --- | --- | --- |
| **Grafana UI** | `3000` | `http://localhost:3000` | `admin` / `admin` |
| **Prometheus UI** | `9090` | `http://localhost:9090` | None |
| **Loki API** | `3100` | `http://localhost:3100/ready` | None |
| **OTel Collector (gRPC)** | `4317` | `localhost:4317` (Trace/Log ingest) | None |
| **OTel Collector (HTTP)** | `4318` | `localhost:4318` (Trace/Log ingest) | None |
| **OTel Collector Metrics** | `8889` | `http://localhost:8889/metrics` | None |

```bash
# Check running containers and health checks
make obs-status

# Stop the stack and purge volumes
make obs-down
```

---

### Option B: Running Downstream Services Locally (`healthcare-api`)

When developing locally on your host machine while the observability containers run:

1. **Link or Install the Shared Package in Target Service:**

```bash
cd ~/Desktop/projects/healthcare-api
pnpm add ../healthcare-observability/packages/nestjs-observability
```

2. **Configure Environment Variables:**

Create or update `.env` in the target service:

```env
SERVICE_NAME=healthcare-api
NODE_ENV=development
PORT=5501
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
LOG_LEVEL=info
```

3. **Bootstrap Tracing in `main.ts`:**

```typescript
import { initTracing } from '@healthcare/nestjs-observability';

// Must be executed before any Nest or Express import
initTracing(process.env.SERVICE_NAME || 'healthcare-api');

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from 'nestjs-pino';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  await app.listen(process.env.PORT || 5501);
}
bootstrap();
```

4. **Start the Service:**

```bash
pnpm run start:dev
```

---

## Makefile Cheatsheet

```bash
make help            # List all available targets
make build           # Build shared packages
make lint            # Run ESLint across packages
make test            # Run unit tests across packages
make obs-up          # Start Docker Compose observability stack
make obs-down        # Stop and remove observability containers
make obs-logs        # Tail all telemetry infrastructure logs
make smoke-test      # Verify metrics, collector, and Loki connectivity
```

---

## Verification & Smoke Testing

Run the included verification suite to confirm data ingestion across all three pillars:

```bash
# 1. Verify Prometheus can reach your service /metrics
curl -s http://localhost:9090/api/v1/targets | grep healthcare

# 2. Verify OpenTelemetry Collector is accepting gRPC connections
nc -zv localhost 4317

# 3. Verify Loki TSDB readiness
curl -s http://localhost:3100/ready

# 4. Trigger an HTTP request on your service and search logs in Loki
curl -i http://localhost:5501/health
```

In Grafana (`http://localhost:3000`):

1. Navigate to **Explore**.
2. Select datasource **Loki** and query: `{service_name="healthcare-api"}`.
3. Click a log entry and click the **TraceID** link to jump directly to the correlated distributed trace.

---

## Deployment: Kubernetes

Deploy the stack into the `observability` namespace:

```bash
# 1. Create namespace and RBAC permissions
kubectl apply -f infra/k8s/00-base-rbac.yaml

# 2. Deploy OpenTelemetry Collector
kubectl apply -f infra/k8s/01-otel-collector.yaml

# 3. Deploy Loki (TSDB with PVC)
kubectl apply -f infra/k8s/02-loki.yaml

# 4. Deploy Prometheus (Dynamic Pod auto-discovery)
kubectl apply -f infra/k8s/03-prometheus.yaml
```

To configure microservices for auto-scraping in Kubernetes, attach the following annotations to each service's deployment manifest:

```yaml
spec:
  template:
    metadata:
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/path: "/metrics"
        prometheus.io/port: "5501" # Target service port
```

---

## Observability Golden Rules

- **No Dynamic Values in Metric Labels:** Never inject `userId`, `appointmentId`, or `traceId` into Prometheus metrics. Use route templates (`/appointments/:id`) only.
- **JSON to stdout:** Do not ship logs over network sockets inside the app runtime. Always stream structured JSON to `stdout`.
- **Propagate W3C Context:** Ensure all outbound HTTP calls and message queue events carry standard `traceparent` headers.
