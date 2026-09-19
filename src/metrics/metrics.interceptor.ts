import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common'
import { Observable } from 'rxjs'
import { tap } from 'rxjs/operators'
import type { Request, Response } from 'express'
import {
  HTTP_REQUEST_DURATION,
  HTTP_REQUESTS_TOTAL,
} from '@/metrics/metrics.constants.js'

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle()
    }

    const httpContext = context.switchToHttp()
    const req = httpContext.getRequest<Request>()
    const res = httpContext.getResponse<Response>()

    const startTime = process.hrtime()

    return next.handle().pipe(
      tap(() => {
        const diff = process.hrtime(startTime)
        const durationInSeconds = diff[0] + diff[1] / 1e9

        // Use the parameterized route path (e.g., /users/:id) to prevent high cardinality
        const routePath =
          (req?.route as { path: string })?.path ||
          req.baseUrl ||
          req.path ||
          'unknown'
        const method = req.method
        const statusCode = res.statusCode ? res.statusCode.toString() : '200'

        HTTP_REQUEST_DURATION.observe(
          { method, route: routePath, status_code: statusCode },
          durationInSeconds,
        )

        HTTP_REQUESTS_TOTAL.inc({
          method,
          route: routePath,
          status_code: statusCode,
        })
      }),
    )
  }
}
