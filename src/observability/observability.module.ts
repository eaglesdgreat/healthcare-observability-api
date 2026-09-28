import { DynamicModule, Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import {
  ObservabilityLoggerModule,
  LoggerConfig,
} from '@/logger/logger.module.js'
import { MetricsController } from '@/metrics/metrics.controller.js'
import { MetricsInterceptor } from '@/metrics/metrics.interceptor.js'

export type ObservabilityModuleOptions = LoggerConfig

@Module({})
export class ObservabilityModule {
  static forRoot(options: ObservabilityModuleOptions): DynamicModule {
    return {
      module: ObservabilityModule,
      imports: [ObservabilityLoggerModule.forRoot(options)],
      controllers: [MetricsController],
      providers: [
        {
          provide: APP_INTERCEPTOR,
          useClass: MetricsInterceptor,
        },
      ],
      exports: [ObservabilityLoggerModule],
    }
  }
}
