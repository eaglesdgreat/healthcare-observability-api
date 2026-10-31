import { Module } from '@nestjs/common'
import { AppController } from './app.controller.js'
import { AppService } from './app.service.js'
import { HealthController } from './health/health.controller.js'
import { ObservabilityModule } from './observability/observability.module.js'

@Module({
  imports: [
    ObservabilityModule.forRoot({
      serviceName:
        process.env.OTEL_SERVICE_NAME ??
        process.env.SERVICE_NAME ??
        'healthcare-observability-api',
      environment: process.env.NODE_ENV,
    }),
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
