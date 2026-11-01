import { Controller, Get } from '@nestjs/common'
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger'

class HealthResponse {
  @ApiProperty({
    description: 'Liveness status of the observability API process.',
    enum: ['ok'],
    example: 'ok',
  })
  status!: 'ok'
}

@Controller('health')
@ApiTags('Health')
export class HealthController {
  @Get()
  @ApiOperation({
    summary: 'Check API liveness',
    description:
      'Returns HTTP 200 while the API process is responsive. This is a liveness check only; it does not verify connectivity to the OpenTelemetry Collector or telemetry storage backends. No path parameters, query parameters, or request body are required.',
  })
  @ApiOkResponse({
    description: 'The API process is alive and accepting requests.',
    type: HealthResponse,
    example: { status: 'ok' },
  })
  getHealth(): HealthResponse {
    return { status: 'ok' }
  }
}
