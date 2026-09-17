import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

export const METRICS_REGISTRY = new Registry();

// Collect core Node.js runtime metrics (event loop lag, memory, CPU)
collectDefaultMetrics({
  register: METRICS_REGISTRY,
  prefix: 'healthcare_',
});

export const HTTP_REQUEST_DURATION = new Histogram({
  name: 'healthcare_http_request_duration_seconds',
  help: 'Histogram of HTTP request durations in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [METRICS_REGISTRY],
});

export const HTTP_REQUESTS_TOTAL = new Counter({
  name: 'healthcare_http_requests_total',
  help: 'Total count of inbound HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [METRICS_REGISTRY],
});
