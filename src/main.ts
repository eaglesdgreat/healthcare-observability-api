import { bootstrapTracing } from './tracing/otel-sdk.js'

async function bootstrap(): Promise<void> {
  bootstrapTracing({
    serviceName:
      process.env.OTEL_SERVICE_NAME ??
      process.env.SERVICE_NAME ??
      'healthcare-observability-api',
  })

  const [{ NestFactory }, { Logger }, { AppModule }, { setupSwagger }] =
    await Promise.all([
      import('@nestjs/core'),
      import('nestjs-pino'),
      import('./app.module.js'),
      import('./swagger/swagger.config.js'),
    ])
  const app = await NestFactory.create(AppModule, { bufferLogs: true })

  app.useLogger(app.get(Logger))
  app.enableShutdownHooks()
  setupSwagger(app)

  await app.listen(process.env.PORT ?? 3000)
}

await bootstrap()
