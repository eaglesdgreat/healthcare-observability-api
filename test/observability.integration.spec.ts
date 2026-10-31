import 'reflect-metadata'
import { Controller, Get, NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { INestApplication } from '@nestjs/common'
import type { Server } from 'node:http'
import request from 'supertest'
import { ObservabilityModule } from '../src/observability/observability.module.js'

@Controller('patients')
class PatientsController {
  @Get(':patientId')
  getPatient(): { status: 'ok' } {
    return { status: 'ok' }
  }

  @Get('missing/:patientId')
  getMissingPatient(): never {
    throw new NotFoundException()
  }
}

describe('ObservabilityModule integration', () => {
  let app: INestApplication
  let server: Server

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ObservabilityModule.forRoot({
          serviceName: 'observability-integration-test',
          environment: 'test',
        }),
      ],
      controllers: [PatientsController],
    }).compile()

    app = module.createNestApplication()
    server = app.getHttpServer() as Server
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('records templated routes without exposing patient identifiers', async () => {
    await request(server).get('/patients/patient-sensitive-id').expect(200)
    const metrics = await request(server).get('/metrics').expect(200)

    expect(metrics.text).toContain(
      'route="/patients/:patientId",status_code="200"',
    )
    expect(metrics.text).not.toContain('patient-sensitive-id')
  })

  it('records HTTP exception status codes', async () => {
    await request(server)
      .get('/patients/missing/patient-sensitive-id')
      .expect(404)
    const metrics = await request(server).get('/metrics').expect(200)

    expect(metrics.text).toContain(
      'route="/patients/missing/:patientId",status_code="404"',
    )
    expect(metrics.text).not.toContain('patient-sensitive-id')
  })
})
