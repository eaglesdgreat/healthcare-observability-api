# Healthcare Observability

A NestJS observability module and local telemetry stack for the healthcare
microservices. The module provides OpenTelemetry tracing, trace-correlated Pino
JSON logs, and low-cardinality Prometheus HTTP metrics.

## Requirements

- Node.js 24.x
- pnpm 11.x (the version pinned in `package.json`)
- Docker Engine with Docker Compose v2 for the local stack
- GNU Make for the optional Makefile shortcuts

## Install and validate

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm run test:integration
pnpm run test:e2e
```

The package exports its reusable NestJS module and tracing bootstrap from
`@healthcare/nestjs-observability`. Build it before installing the local
directory from another service:

```sh
pnpm build
cd ../healthcare-api
pnpm add ../healthcare-observability
```

## Use in a NestJS service

Initialize tracing before importing NestJS, HTTP frameworks, or database
drivers. In an ESM entrypoint, use dynamic imports to preserve that order:

```ts
import { bootstrapTracing } from '@healthcare/nestjs-observability'

bootstrapTracing({
  serviceName: process.env.SERVICE_NAME ?? 'healthcare-api',
})

const [{ NestFactory }, { AppModule }, { Logger }] = await Promise.all([
  import('@nestjs/core'),
  import('./app.module.js'),
  import('nestjs-pino'),
])

const app = await NestFactory.create(AppModule, { bufferLogs: true })
app.useLogger(app.get(Logger))
app.enableShutdownHooks()
await app.listen(process.env.PORT ?? 5501)
```

Register `ObservabilityModule.forRoot({ serviceName: 'healthcare-api' })` in
the application module. `OTEL_EXPORTER_OTLP_ENDPOINT` defaults to
`http://localhost:4317`; `OTEL_SERVICE_NAME`, `SERVICE_NAME`, `NODE_ENV`,
`LOG_LEVEL`, and `PORT` can be set per service. Tracing shutdown is connected
to Nest application shutdown hooks.

## Local observability stack

```sh
docker compose config --quiet
docker compose up --build -d
```

The Compose stack runs the sample API, OpenTelemetry Collector, Prometheus,
Loki, Tempo, Grafana Alloy, and Grafana.

| Component          | Local URL                       |
| ------------------ | ------------------------------- |
| Sample API         | http://localhost:3001           |
| API health         | http://localhost:3001/health    |
| Prometheus metrics | http://localhost:3001/metrics   |
| Grafana            | http://localhost:3000           |
| Prometheus         | http://localhost:9090           |
| Loki readiness     | http://localhost:3100/ready     |
| Tempo              | http://localhost:3200           |
| OTLP gRPC / HTTP   | localhost:4317 / localhost:4318 |

Grafana's local-only default credentials are `admin` / `admin`; set
`GRAFANA_ADMIN_USER` and `GRAFANA_ADMIN_PASSWORD` before starting the stack to
override them. Do not use these defaults in a shared or production
environment.

Alloy reads container stdout through the Docker socket and forwards JSON log
lines to Loki. This is a local-development setup: the socket grants broad
control over the Docker host. Production deployments should use the platform's
approved log collection agent, authenticated OTLP endpoints, persistent
backends, and secret-managed credentials. Prometheus uses static Compose
targets; Kubernetes service discovery and deployment manifests are not
included in this repository yet.

Run `make help` for shortcuts. `make obs-down` preserves named volumes; remove
them explicitly with `docker compose down --volumes` when intentionally
discarding local telemetry data.
