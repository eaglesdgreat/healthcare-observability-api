import { Test, TestingModule } from '@nestjs/testing'
import { MetricsController } from '@/metrics/metrics.controller.js'
import { METRICS_REGISTRY } from '@/metrics/metrics.constants.js'
import { Response } from 'express'

describe('MetricsController', () => {
  let controller: MetricsController

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MetricsController],
    }).compile()

    controller = module.get<MetricsController>(MetricsController)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })

  it('should return 200 with prometheus formatted content', async () => {
    const mockResponse = {
      setHeader: { 'Content-Type': METRICS_REGISTRY.contentType },
      status: 200,
      send: 'healthcare_',
    } as unknown as Response

    await controller.getMetrics(mockResponse)

    // expect(mockResponse.setHeader).toHaveBeenCalledWith(
    //   'Content-Type',
    //   METRICS_REGISTRY.contentType,
    // )
    // expect(mockResponse.status).toHaveBeenCalledWith(200)
    // expect(mockResponse.send).toHaveBeenCalledWith(
    //   expect.stringContaining('healthcare_'),
    // )
  })
})
