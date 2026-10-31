import { Injectable, OnApplicationShutdown } from '@nestjs/common'
import { shutdownTracing } from './otel-sdk.js'

@Injectable()
export class TelemetryLifecycleService implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await shutdownTracing()
  }
}
