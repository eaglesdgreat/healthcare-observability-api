import { Controller, Get, Res } from '@nestjs/common'
import { type Response } from 'express'
import { METRICS_REGISTRY } from '@/metrics/metrics.constants.js'

@Controller('metrics')
export class MetricsController {
  @Get()
  async getMetrics(@Res() res: Response): Promise<void> {
    res.setHeader('Content-Type', METRICS_REGISTRY.contentType)
    const metrics = await METRICS_REGISTRY.metrics()
    res.status(200).send(metrics)
  }
}
