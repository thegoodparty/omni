import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
  Optional,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { from, lastValueFrom, map, Observable, of } from 'rxjs'
import { IS_PUBLIC_KEY } from 'src/authentication/decorators/PublicAccess.decorator'

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8'

// Buffers live outside the V8 heap, so the budget is counted in bytes rather
// than entries. Tasks reserve 4 GB and normally use a few hundred MB.
const DEFAULT_MAX_TOTAL_BYTES = 256 * 1024 * 1024
// The largest prod responses (every place in a state) are about 7 MB.
const DEFAULT_MAX_ENTRY_BYTES = 16 * 1024 * 1024

export const RESPONSE_CACHE_OPTIONS = Symbol('RESPONSE_CACHE_OPTIONS')

export type ResponseCacheOptions = {
  ttlMs: number
  maxTotalBytes?: number
  maxEntryBytes?: number
}

// Either the serialized body, or a value we chose not to cache (null, a
// string) that every waiter still has to receive unchanged.
type Settled =
  | { cached: true; body: Buffer }
  | { cached: false; value: unknown }

type Entry = { body: Buffer; expiresAtMs: number }

const ttlFromEnv = (): number => {
  const seconds = Number(process.env.RESPONSE_CACHE_TTL_SECONDS ?? '0')
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0
}

/**
 * Per-task cache for authenticated GET responses, keyed on the full URL.
 *
 * The data here is loaded by a daily pipeline, and most traffic is
 * gp-marketing rendering public pages. When a crawler sweeps those pages, many
 * renders ask for the same URLs within minutes, and each repeat costs Prisma
 * and JSON work on a single-vCPU task. Answering repeats from memory keeps a
 * burst from saturating CPU and starving the Prisma pool that gp-api's
 * product routes share (ENG-11302). Concurrent misses for one URL share one
 * handler run.
 *
 * Interceptors run after guards, so only callers that passed M2M auth read
 * from the cache. `@PublicAccess` routes (the health check) skip it so the ALB
 * sees live health. Errors are never cached; concurrent waiters get the same
 * error the first request got.
 *
 * Off unless RESPONSE_CACHE_TTL_SECONDS is above 0, so local runs and tests
 * always read freshly seeded data.
 */
@Injectable()
export class ResponseCacheInterceptor implements NestInterceptor {
  private readonly ttlMs: number
  private readonly maxTotalBytes: number
  private readonly maxEntryBytes: number

  // Map keeps insertion order, so the first key is the least recently used.
  private readonly entries = new Map<string, Entry>()
  private readonly inFlight = new Map<string, Promise<Settled>>()
  private totalBytes = 0

  constructor(
    private readonly reflector: Reflector,
    @Optional()
    @Inject(RESPONSE_CACHE_OPTIONS)
    options: ResponseCacheOptions = { ttlMs: ttlFromEnv() },
  ) {
    this.ttlMs = options.ttlMs
    this.maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES
    this.maxEntryBytes = options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (this.ttlMs <= 0 || context.getType() !== 'http') return next.handle()

    const http = context.switchToHttp()
    const request = http.getRequest<FastifyRequest>()
    if (request.method !== 'GET') return next.handle()

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return next.handle()

    const reply = http.getResponse<FastifyReply>()
    const key = request.url

    const hit = this.read(key, Date.now())
    if (hit) return of(this.sendJson(reply, hit))

    let pending = this.inFlight.get(key)
    if (!pending) {
      pending = lastValueFrom(next.handle())
        .then((value) => this.settle(key, value))
        .finally(() => this.inFlight.delete(key))
      this.inFlight.set(key, pending)
    }

    return from(pending).pipe(
      map((settled) =>
        settled.cached ? this.sendJson(reply, settled.body) : settled.value,
      ),
    )
  }

  private read(key: string, nowMs: number): Buffer | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    this.entries.delete(key)
    if (entry.expiresAtMs <= nowMs) {
      this.totalBytes -= entry.body.length
      return undefined
    }
    // Re-insert to mark it most recently used.
    this.entries.set(key, entry)
    return entry.body
  }

  private settle(key: string, value: unknown): Settled {
    // null, strings and other non-JSON-object results go back as they are.
    if (value === null || typeof value !== 'object' || Buffer.isBuffer(value)) {
      return { cached: false, value }
    }

    // Fastify would run the same JSON.stringify on send. Doing it here once
    // means a hit costs no serialization at all.
    const body = Buffer.from(JSON.stringify(value))
    if (body.length <= this.maxEntryBytes) this.store(key, body)
    return { cached: true, body }
  }

  private store(key: string, body: Buffer): void {
    const existing = this.entries.get(key)
    if (existing) {
      this.entries.delete(key)
      this.totalBytes -= existing.body.length
    }
    this.entries.set(key, { body, expiresAtMs: Date.now() + this.ttlMs })
    this.totalBytes += body.length

    for (const [oldestKey, oldest] of this.entries) {
      if (this.totalBytes <= this.maxTotalBytes) break
      this.entries.delete(oldestKey)
      this.totalBytes -= oldest.body.length
    }
  }

  private sendJson(reply: FastifyReply, body: Buffer): Buffer {
    // Without this, Fastify sends a Buffer as application/octet-stream.
    void reply.header('content-type', JSON_CONTENT_TYPE)
    return body
  }
}
