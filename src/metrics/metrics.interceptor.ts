import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common'
import { Observable } from 'rxjs'
import { finalize, tap } from 'rxjs/operators'
import type { Request, Response } from 'express'
import {
  HTTP_REQUEST_DURATION,
  HTTP_REQUESTS_TOTAL,
} from './metrics.constants.js'

const SUPPORTED_HTTP_METHODS = new Set([
  'ACL',
  'BIND',
  'CHECKOUT',
  'CONNECT',
  'COPY',
  'DELETE',
  'GET',
  'HEAD',
  'LINK',
  'LOCK',
  'M-SEARCH',
  'MERGE',
  'MKACTIVITY',
  'MKCALENDAR',
  'MKCOL',
  'MOVE',
  'NOTIFY',
  'OPTIONS',
  'PATCH',
  'POST',
  'PROPFIND',
  'PROPPATCH',
  'PURGE',
  'PUT',
  'QUERY',
  'REBIND',
  'REPORT',
  'SEARCH',
  'SOURCE',
  'SUBSCRIBE',
  'TRACE',
  'UNBIND',
  'UNLINK',
  'UNLOCK',
  'UNSUBSCRIBE',
])

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle()
    }

    const httpContext = context.switchToHttp()
    const req = httpContext.getRequest<Request>()
    const res = httpContext.getResponse<Response>()

    const startTime = process.hrtime.bigint()
    let errorStatusCode: number | undefined

    return next.handle().pipe(
      tap({
        error: (error: unknown) => {
          errorStatusCode =
            error instanceof HttpException ? error.getStatus() : 500
        },
      }),
      finalize(() => {
        const durationInSeconds =
          Number(process.hrtime.bigint() - startTime) / 1e9
        const route: unknown = req.route
        const routePath =
          typeof route === 'object' &&
          route !== null &&
          'path' in route &&
          typeof route.path === 'string'
            ? route.path
            : 'unmatched'
        const method = this.normalizeMethod(req.method)
        const statusCode = String(errorStatusCode ?? res.statusCode ?? 200)
        const labels = {
          method,
          route: routePath,
          status_code: statusCode,
        }

        HTTP_REQUEST_DURATION.observe(labels, durationInSeconds)
        HTTP_REQUESTS_TOTAL.inc(labels)
      }),
    )
  }

  private normalizeMethod(method: string | undefined): string {
    const normalizedMethod = method?.toUpperCase()

    return normalizedMethod && SUPPORTED_HTTP_METHODS.has(normalizedMethod)
      ? normalizedMethod
      : 'OTHER'
  }
}
