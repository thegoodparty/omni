import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  ServiceUnavailableException,
} from '@nestjs/common'
import { Observable, finalize, from, switchMap, throwError } from 'rxjs'
import { IncomingRequest } from '@/authentication/authentication.types'
import { EVENT_LOOP_LAG_SHED_MS, recentEventLoopLagMs } from './eventLoopLag'

export const SERVICE_READ_MAX_IN_FLIGHT = 30
export const SERVICE_READ_MAX_WAIT_MS = 30_000

/**
 * Caps how many machine-caller reads (gp-marketing's crawl) run against
 * election-db at once, per process, across every route that applies it. The pool has 50 connections and fails a
 * request that waits more than 5s for one, so a burst from this one caller
 * used to take every connection and fail its own tail with P2024 while
 * leaving nothing for the health probe or user-facing reads. Excess reads wait
 * here instead, up to SERVICE_READ_MAX_WAIT_MS, and the 20 connections the cap
 * leaves free stay available to everyone else. Human callers are not gated.
 *
 * The cap bounds connections, not CPU. A crawl that fits the cap can still
 * keep the task's one thread busy, and a task whose event loop lags past
 * EVENT_LOOP_LAG_SHED_MS stops answering the load balancer's health probe and
 * is killed, taking every caller with it (ENG-11524). So machine reads are
 * refused outright while the loop is lagging; the crawler retries, and users
 * and the probe keep the thread.
 */
@Injectable()
export class ServiceReadConcurrencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ServiceReadConcurrencyInterceptor.name)
  // Static so every controller that applies this interceptor draws on the same
  // per-process budget: Nest builds one instance per host module, and the cap
  // protects one pool.
  private static inFlight = 0
  private static readonly waiters: Array<() => void> = []

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<IncomingRequest>()
    if (!req.serviceReader && !req.m2mToken) return next.handle()

    const lagMs = recentEventLoopLagMs()
    if (lagMs > EVENT_LOOP_LAG_SHED_MS) {
      this.logger.warn(
        `Machine read refused: event loop p99 lag ${Math.round(lagMs)}ms.`,
      )
      return throwError(
        () => new ServiceUnavailableException('Election data is busy'),
      )
    }

    return from(this.acquire()).pipe(
      switchMap(() => next.handle().pipe(finalize(() => this.release()))),
    )
  }

  private acquire(): Promise<void> {
    if (
      ServiceReadConcurrencyInterceptor.inFlight < SERVICE_READ_MAX_IN_FLIGHT
    ) {
      ServiceReadConcurrencyInterceptor.inFlight++
      return Promise.resolve()
    }
    return new Promise<void>((resolve, reject) => {
      const grant = () => {
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(() => {
        const index = ServiceReadConcurrencyInterceptor.waiters.indexOf(grant)
        if (index >= 0)
          ServiceReadConcurrencyInterceptor.waiters.splice(index, 1)
        this.logger.warn(
          `Machine read waited ${SERVICE_READ_MAX_WAIT_MS}ms for an election-db slot; refusing it.`,
        )
        reject(new ServiceUnavailableException('Election data is busy'))
      }, SERVICE_READ_MAX_WAIT_MS)
      ServiceReadConcurrencyInterceptor.waiters.push(grant)
    })
  }

  private release(): void {
    const next = ServiceReadConcurrencyInterceptor.waiters.shift()
    if (next) {
      next()
      return
    }
    ServiceReadConcurrencyInterceptor.inFlight--
  }
}
