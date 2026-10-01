import 'reflect-metadata'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ExecutionContext, CallHandler } from '@nestjs/common'
import { of, firstValueFrom } from 'rxjs'
import { MetricsInterceptor } from '../src/metrics/metrics.interceptor'
import {
  HTTP_REQUEST_DURATION,
  HTTP_REQUESTS_TOTAL,
} from '../src/metrics/metrics.constants'

describe('MetricsInterceptor', () => {
  let interceptor: MetricsInterceptor

  beforeEach(() => {
    interceptor = new MetricsInterceptor()
    vi.spyOn(HTTP_REQUEST_DURATION, 'observe')
    vi.spyOn(HTTP_REQUESTS_TOTAL, 'inc')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should record metrics using route path template rather than raw dynamic values', async () => {
    const mockRequest = {
      method: 'GET',
      route: { path: '/appointments/:id' },
      baseUrl: '',
      path: '/appointments/123e4567-e89b',
    }
    const mockResponse = { statusCode: 200 }

    const mockExecutionContext = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
    } as unknown as ExecutionContext

    const mockCallHandler: CallHandler = {
      handle: () => of({ success: true }),
    }

    // Use RxJS firstValueFrom for clean async/await in Vitest
    await firstValueFrom(
      interceptor.intercept(mockExecutionContext, mockCallHandler),
    )

    expect(HTTP_REQUESTS_TOTAL.inc).toHaveBeenCalledWith({
      method: 'GET',
      route: '/appointments/:id',
      status_code: '200',
    })

    expect(HTTP_REQUEST_DURATION.observe).toHaveBeenCalledWith(
      {
        method: 'GET',
        route: '/appointments/:id',
        status_code: '200',
      },
      expect.any(Number),
    )
  })

  it('should pass through non-http execution contexts without recording metrics', async () => {
    const mockRpcContext = {
      getType: () => 'rpc',
    } as unknown as ExecutionContext

    const mockCallHandler: CallHandler = {
      handle: () => of({ rpcResult: true }),
    }

    const result = await firstValueFrom(
      interceptor.intercept(mockRpcContext, mockCallHandler),
    )

    expect(result).toEqual({ rpcResult: true })
    expect(HTTP_REQUESTS_TOTAL.inc).not.toHaveBeenCalled()
    expect(HTTP_REQUEST_DURATION.observe).not.toHaveBeenCalled()
  })
})
