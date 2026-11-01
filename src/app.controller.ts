import { Controller, Get } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { AppService } from './app.service.js'

@Controller()
@ApiTags('Service')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({
    summary: 'Get the service welcome message',
    description:
      'Returns a simple text response for confirming that the observability API is reachable. This endpoint does not accept path parameters, query parameters, or a request body.',
  })
  @ApiOkResponse({
    description: 'The service welcome message.',
    content: {
      'text/plain': {
        schema: {
          type: 'string',
          example: 'Hello World!',
        },
        example: 'Hello World!',
      },
    },
  })
  getHello(): string {
    return this.appService.getHello()
  }
}
