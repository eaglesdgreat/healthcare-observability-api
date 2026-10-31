import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import request from 'supertest'
import type { Server } from 'node:http'
import { AppModule } from './../src/app.module.js'

describe('AppController (e2e)', () => {
  let app: INestApplication
  let server: Server

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    server = app.getHttpServer() as Server
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

  afterEach(async () => {
    await app.close()
  })
})
