import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  CallHandler,
  ExecutionContext,
  NotFoundException,
} from '@nestjs/common'
import { firstValueFrom, of, throwError } from 'rxjs'
import { MetricsInterceptor } from '../src/metrics/metrics.interceptor.js'
import {
  HTTP_REQUEST_DURATION,
  HTTP_REQUESTS_TOTAL,
} from '../src/metrics/metrics.constants.js'

describe('MetricsInterceptor', () => {
  let interceptor: MetricsInterceptor

  beforeEach(() => {
    interceptor = new MetricsInterceptor()
    HTTP_REQUEST_DURATION.reset()
    HTTP_REQUESTS_TOTAL.reset()
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

    const requestMetrics = await HTTP_REQUESTS_TOTAL.get()
    expect(requestMetrics.values).toContainEqual({
      labels: {
        method: 'GET',
        route: '/appointments/:id',
        status_code: '200',
      },
      value: 1,
    })

    const durationMetrics = await HTTP_REQUEST_DURATION.get()
    expect(durationMetrics.values).toContainEqual(
      expect.objectContaining({
        labels: {
          method: 'GET',
          route: '/appointments/:id',
          status_code: '200',
          le: '+Inf',
        },
        value: 1,
      }),
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
    expect((await HTTP_REQUESTS_TOTAL.get()).values).toHaveLength(0)
    expect((await HTTP_REQUEST_DURATION.get()).values).toHaveLength(0)
  })

  it('uses a bounded route and method label when no matched route exists', async () => {
    const mockRequest = {
      method: 'CUSTOM',
      path: '/patients/123',
    }
    const mockResponse = { statusCode: 404 }
    const mockExecutionContext = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => mockRequest,
        getResponse: () => mockResponse,
      }),
    } as unknown as ExecutionContext
    const mockCallHandler: CallHandler = { handle: () => of(null) }

    await firstValueFrom(
      interceptor.intercept(mockExecutionContext, mockCallHandler),
    )

    expect((await HTTP_REQUESTS_TOTAL.get()).values).toContainEqual({
      labels: {
        method: 'OTHER',
        route: 'unmatched',
        status_code: '404',
      },
      value: 1,
    })
  })

  it('records failed requests with the exception status code', async () => {
    const mockExecutionContext = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'GET',
          route: { path: '/appointments/:id' },
        }),
        getResponse: () => ({ statusCode: 200 }),
      }),
    } as unknown as ExecutionContext
    const mockCallHandler: CallHandler = {
      handle: () => throwError(() => new NotFoundException()),
    }

    await expect(
      firstValueFrom(
        interceptor.intercept(mockExecutionContext, mockCallHandler),
      ),
    ).rejects.toBeInstanceOf(NotFoundException)

    expect((await HTTP_REQUESTS_TOTAL.get()).values).toContainEqual({
      labels: {
        method: 'GET',
        route: '/appointments/:id',
        status_code: '404',
      },
      value: 1,
    })
  })
})
