import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  ServiceUnavailableException,
} from '@nestjs/common'
import { Observable, finalize, from, switchMap } from 'rxjs'
import { IncomingRequest } from '@/authentication/authentication.types'

export const SERVICE_READ_MAX_IN_FLIGHT = 30
export const SERVICE_READ_MAX_WAIT_MS = 30_000

/**
 * Caps how many machine-caller reads (gp-marketing's crawl) run against
 * election-db at once, per process. The pool has 50 connections and fails a
 * request that waits more than 5s for one, so a burst from this one caller
 * used to take every connection and fail its own tail with P2024 while
 * leaving nothing for the health probe or user-facing reads. Excess reads wait
 * here instead, up to SERVICE_READ_MAX_WAIT_MS, and the 20 connections the cap
 * leaves free stay available to everyone else. Human callers are not gated.
 */
@Injectable()
export class ServiceReadConcurrencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ServiceReadConcurrencyInterceptor.name)
  private inFlight = 0
  private readonly waiters: Array<() => void> = []

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<IncomingRequest>()
    if (!req.serviceReader && !req.m2mToken) return next.handle()

    return from(this.acquire()).pipe(
      switchMap(() => next.handle().pipe(finalize(() => this.release()))),
    )
  }

  private acquire(): Promise<void> {
    if (this.inFlight < SERVICE_READ_MAX_IN_FLIGHT) {
      this.inFlight++
      return Promise.resolve()
    }
    return new Promise<void>((resolve, reject) => {
      const grant = () => {
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(grant)
        if (index >= 0) this.waiters.splice(index, 1)
        this.logger.warn(
          `Machine read waited ${SERVICE_READ_MAX_WAIT_MS}ms for an election-db slot; refusing it.`,
        )
        reject(new ServiceUnavailableException('Election data is busy'))
      }, SERVICE_READ_MAX_WAIT_MS)
      this.waiters.push(grant)
    })
  }

  private release(): void {
    const next = this.waiters.shift()
    if (next) {
      next()
      return
    }
    this.inFlight--
  }
}
