import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import type { Server } from 'node:http'
import { AppModule } from './../src/app.module.js'
import { METRICS_REGISTRY } from '../src/metrics/metrics.constants.js'
import { setupSwagger } from '../src/swagger/swagger.config.js'

interface OpenApiResponse {
  description: string
  content?: Record<
    string,
    {
      example?: unknown
      schema?: { example?: unknown }
    }
  >
}

interface OpenApiOperation {
  summary: string
  description: string
  parameters?: unknown[]
  requestBody?: unknown
  responses: Record<string, OpenApiResponse>
}

interface OpenApiDocument {
  info: { title: string; version: string }
  paths: Record<string, { get: OpenApiOperation }>
}

describe('AppController (e2e)', () => {
  let app: INestApplication
  let server: Server

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    server = app.getHttpServer() as Server
    setupSwagger(app)
    await app.init()
  })

  it('/ (GET)', () => {
    return request(server).get('/').expect(200).expect('Hello World!')
  })

  it('/health (GET)', () => {
    return request(server).get('/health').expect(200).expect({ status: 'ok' })
  })

  it('/metrics (GET)', () => {
    return request(server)
      .get('/metrics')
      .expect(200)
      .expect('Content-Type', /text\/plain/)
      .expect((response) => {
        expect(response.text).toContain('healthcare_http_requests_total')
      })
  })

  it('/api/docs-json (GET)', async () => {
    const response = await request(server).get('/api/docs-json').expect(200)
    const document = JSON.parse(response.text) as OpenApiDocument

    expect(document.info).toMatchObject({
      title: 'Healthcare Observability API',
      version: '1.0.0',
    })
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining(['/', '/health', '/metrics']),
    )
    expect(document.paths['/'].get).toMatchObject({
      summary: 'Get the service welcome message',
      responses: {
        '200': {
          description: 'The service welcome message.',
          content: {
            'text/plain': {
              schema: { example: 'Hello World!' },
            },
          },
        },
      },
    })
    expect(document.paths['/'].get.parameters ?? []).toEqual([])
    expect(document.paths['/'].get.requestBody).toBeUndefined()
    const healthOperation = document.paths['/health'].get
    expect(healthOperation.summary).toBe('Check API liveness')
    expect(healthOperation.description).toContain('liveness')
    expect(healthOperation.responses['200'].description).toBe(
      'The API process is alive and accepting requests.',
    )
    expect(
      healthOperation.responses['200'].content?.['application/json']?.example,
    ).toEqual({ status: 'ok' })
    expect(healthOperation.parameters ?? []).toEqual([])
    expect(healthOperation.requestBody).toBeUndefined()

    const metricsOperation = document.paths['/metrics'].get
    expect(metricsOperation.summary).toBe('Scrape Prometheus metrics')
    expect(metricsOperation.description).toContain('Prometheus exposition')
    expect(
      metricsOperation.responses['200'].content?.[METRICS_REGISTRY.contentType]
        ?.schema?.example,
    ).toContain('healthcare_http_requests_total')
    expect(metricsOperation.responses['500'].description).toBe(
      'The metrics registry could not be collected or serialized.',
    )
    expect(metricsOperation.parameters ?? []).toEqual([])
    expect(metricsOperation.requestBody).toBeUndefined()
  })

  it('/api/docs (GET)', () => {
    return request(server)
      .get('/api/docs')
      .expect(200)
      .expect('Content-Type', /text\/html/)
      .expect((response) => {
        expect(response.text).toContain('Healthcare Observability API')
      })
  })

  afterEach(async () => {
    await app.close()
  })
})
