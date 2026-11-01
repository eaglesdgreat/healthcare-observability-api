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

## Continuous integration

The GitHub Actions workflow runs for pull requests targeting `main` when opened,
updated with new commits, or reopened; it can also be started manually. It does
not run on branch pushes, avoiding a duplicate check for commits pushed to an
open pull request. Each stage gates the next so failures stop the pipeline
early:

1. TypeScript typecheck, then ESLint.
2. Unit tests.
3. Integration tests.
4. End-to-end tests.
5. Build and start the production bundle; poll `/health`, validate `/metrics`
   (including request and Node.js process metrics), verify `/api/docs-json`
   describes all endpoints, and check structured request logs for valid trace
   and span IDs.
6. Build the release Docker image.

The CI smoke check intentionally runs before the final Docker image build and
does not require external databases, credentials, or telemetry backends. The
Compose stack has its own container health check and can be verified locally:

```sh
make obs-up
make smoke-test
make obs-status
```

`make smoke-test` checks the API health and metrics endpoints and confirms
Prometheus can scrape the API. Stop the local stack with `make obs-down`.

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

| Component          | Local URL                           |
| ------------------ | ----------------------------------- |
| Sample API         | http://localhost:3001               |
| API health         | http://localhost:3001/health        |
| Prometheus metrics | http://localhost:3001/metrics       |
| Swagger UI         | http://localhost:3001/api/docs      |
| OpenAPI JSON       | http://localhost:3001/api/docs-json |
| Grafana            | http://localhost:3000               |
| Prometheus         | http://localhost:9090               |
| Loki readiness     | http://localhost:3100/ready         |
| Tempo              | http://localhost:3200               |
| OTLP gRPC / HTTP   | localhost:4317 / localhost:4318     |

## HTTP API documentation

The service publishes interactive Swagger UI at `/api/docs` and its OpenAPI
3.0 document at `/api/docs-json`. Both describe the service endpoints, response
content types, and examples. The application endpoints are `GET` routes with
no path parameters, query parameters, or request body.

| Endpoint       | Description                                                             | Successful response                                                                                       |
| -------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `GET /`        | Basic reachability greeting.                                            | `200 text/plain`; example: `Hello World!`                                                                 |
| `GET /health`  | Process liveness only; does not test collector or backend connectivity. | `200 application/json`; example: `{"status":"ok"}`                                                        |
| `GET /metrics` | Prometheus exposition for application and Node.js metrics.              | `200 text/plain; version=0.0.4; charset=utf-8`; includes metric samples and `# HELP` / `# TYPE` metadata. |

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

When the notification API is running in its Docker Compose stack with port
`5502` published, Prometheus scrapes
`http://host.docker.internal:5502/api/metrics` using the
`healthcare-notification-api` job. The Prometheus container maps
`host.docker.internal` to the Docker host gateway for Linux compatibility.
Alloy discovers the API container through the shared Docker daemon and sends
its JSON stdout logs to Loki. The notification API does not currently export
OpenTelemetry traces; its request IDs do not represent distributed trace IDs.

Run `make help` for shortcuts. `make obs-down` preserves named volumes; remove
them explicitly with `docker compose down --volumes` when intentionally
discarding local telemetry data.
