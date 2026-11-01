import type { INestApplication } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Healthcare Observability API')
    .setDescription(
      'HTTP endpoints for the healthcare observability service, including liveness and Prometheus metrics scraping.',
    )
    .setVersion(process.env.npm_package_version ?? '1.0.0')
    .build()
  const document = SwaggerModule.createDocument(app, config)

  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'Healthcare Observability API Documentation',
    jsonDocumentUrl: 'api/docs-json',
  })
}
