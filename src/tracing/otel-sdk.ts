import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { Resource } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

export interface TracingConfig {
  serviceName: string;
  serviceVersion?: string;
  environment?: string;
  collectorEndpoint?: string;
}

let sdkInstance: NodeSDK | null = null;

export function bootstrapTracing(config: TracingConfig): NodeSDK {
  if (sdkInstance) {
    return sdkInstance;
  }

  const endpoint =
    config.collectorEndpoint ||
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    'http://localhost:4317';
  const environment =
    config.environment || process.env.NODE_ENV || 'development';
  const version =
    config.serviceVersion || process.env.npm_package_version || '1.0.0';

  const traceExporter = new OTLPTraceExporter({
    url: endpoint,
  });

  sdkInstance = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: version,
      'deployment.environment': environment,
    }),
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  });

  sdkInstance.start();

  process.on('SIGTERM', () => {
    sdkInstance
      ?.shutdown()
      .then(() => console.log('[Telemetry] Tracing SDK gracefully shut down'))
      .catch((err) =>
        console.error('[Telemetry] Error shutting down Tracing SDK', err),
      )
      .finally(() => process.exit(0));
  });

  return sdkInstance;
}
