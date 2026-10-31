import { DynamicModule, Module } from '@nestjs/common'
import { LoggerModule } from 'nestjs-pino'
import { trace, context } from '@opentelemetry/api'
import type { IncomingMessage, ServerResponse } from 'node:http'

export interface LoggerConfig {
  serviceName: string
  serviceVersion?: string
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
        base: {
          service: {
            name: config.serviceName,
            version:
              config.serviceVersion ??
              process.env.npm_package_version ??
              '1.0.0',
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
            traceFlags: spanContext.traceFlags,
          }
        },
        serializers: {
          req: (
            req: IncomingMessage & {
              id?: string
              route?: { path?: string }
            },
          ) => {
            return {
              id: req.id,
              method: req.method,
              route: req.route?.path ?? 'unmatched',
            }
          },
          res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
        },
      },
    })
  }
}
