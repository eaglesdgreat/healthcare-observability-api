import { DynamicModule, Module } from '@nestjs/common'
import { LoggerModule } from 'nestjs-pino'
import { trace, context } from '@opentelemetry/api'

export interface LoggerConfig {
  serviceName: string
  environment?: string
  logLevel?: string
}

@Module({})
export class ObservabilityLoggerModule {
  static forRoot(config: LoggerConfig): DynamicModule {
    const environment =
      config.environment || process.env.NODE_ENV || 'development'
    const logLevel = config.logLevel || process.env.LOG_LEVEL || 'info'

    return LoggerModule.forRoot({
      pinoHttp: {
        level: logLevel,
        messageKey: 'message',
        timestamp: () => `,"time":${Date.now()}`,
        base: {
          service: {
            name: config.serviceName,
            version: process.env.npm_package_version || '1.0.0',
          },
          environment,
        },
        formatters: {
          level: (label: string) => ({ severity: label.toUpperCase() }),
        },
        mixin: () => {
          const activeSpan = trace.getSpan(context.active())
          if (!activeSpan) return {}
          const spanContext = activeSpan.spanContext()
          return {
            traceId: spanContext.traceId,
            spanId: spanContext.spanId,
          }
        },
        serializers: {
          req: (req) => ({
            id: (req as { id: string }).id,
            method: (req as { method: string }).method,
            url: (req as { url: string }).url,
          }),
          res: (res) => ({
            statusCode: (res as { statusCode: number }).statusCode,
          }),
        },
      },
    })
  }
}
