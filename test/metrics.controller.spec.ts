import 'reflect-metadata'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Test, TestingModule } from '@nestjs/testing'
import { Response } from 'express'
import { MetricsController } from '@/metrics/metrics.controller.js'
import { METRICS_REGISTRY } from '@/metrics/metrics.constants.js'

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

  it('should return 200 with Prometheus-formatted content', async () => {
    const setHeader = vi.fn()
    const status = vi.fn().mockReturnThis()
    const send = vi.fn()
    const mockResponse = {
      setHeader,
      status,
      send,
    } as unknown as Response

    await controller.getMetrics(mockResponse)

    expect(setHeader).toHaveBeenCalledWith(
      'Content-Type',
      METRICS_REGISTRY.contentType,
    )
    expect(status).toHaveBeenCalledWith(200)
    expect(send).toHaveBeenCalledWith(expect.stringContaining('healthcare_'))
  })
})
