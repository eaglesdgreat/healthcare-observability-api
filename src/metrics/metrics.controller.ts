import { Controller, Get, Res } from '@nestjs/common'
import {
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger'
import { type Response } from 'express'
import { METRICS_REGISTRY } from './metrics.constants.js'

@Controller('metrics')
@ApiTags('Metrics')
export class MetricsController {
  @Get()
  @ApiOperation({
    summary: 'Scrape Prometheus metrics',
    description:
      'Returns the current Prometheus exposition for HTTP request counters, request duration histograms, and Node.js runtime metrics. This is a pull endpoint intended for Prometheus-compatible scrapers. No path parameters, query parameters, or request body are required.',
  })
  @ApiProduces(METRICS_REGISTRY.contentType)
  @ApiOkResponse({
    description:
      'Prometheus text exposition containing application and process metrics.',
    schema: {
      type: 'string',
      example: [
        '# HELP healthcare_http_requests_total Total count of inbound HTTP requests',
        '# TYPE healthcare_http_requests_total counter',
        'healthcare_http_requests_total{method="GET",route="/health",status_code="200"} 12',
      ].join('\n'),
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'The metrics registry could not be collected or serialized.',
  })
  async getMetrics(@Res() res: Response): Promise<void> {
    res.setHeader('Content-Type', METRICS_REGISTRY.contentType)
    const metrics = await METRICS_REGISTRY.metrics()
    res.status(200).send(metrics)
  }
}
