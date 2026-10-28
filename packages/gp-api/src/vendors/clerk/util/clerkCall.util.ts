import { Attributes, SpanStatusCode, trace } from '@opentelemetry/api'
import { CLERK_API_TIMEOUT_MS } from '@/vendors/clerk/clerk.consts'

const tracer = trace.getTracer('gp-api.clerk')

export class ClerkTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Clerk API call exceeded ${timeoutMs}ms`)
    this.name = 'ClerkTimeoutError'
  }
}

// The Clerk SDK talks over fetch/undici, which our OTel setup does not
// instrument, so an in-flight Clerk call is invisible in Tempo: a stalled
// request shows an unexplained gap between spans rather than a named
// dependency. Wrap every call so it reports itself and cannot hang forever.
//
// Promise.race unblocks the caller but does not cancel the underlying request;
// ClerkOptions exposes no fetcher to abort through. The socket is left to
// finish on its own, which is acceptable because the point is to free the
// request path, not to save the connection.
//
// Pass `timeoutMs: null` for a call that makes no network request (a JWT
// verified locally against CLERK_JWT_KEY). It keeps the span but skips the
// race, because there the timer can only fire when the event loop itself was
// frozen, which would 403 a request whose token is fine.
export const clerkCall = <T>(
  operation: string,
  attributes: Attributes,
  op: () => Promise<T>,
  timeoutMs: number | null = CLERK_API_TIMEOUT_MS,
): Promise<T> =>
  tracer.startActiveSpan(
    `clerk.${operation}`,
    {
      attributes: {
        ...attributes,
        ...(timeoutMs === null ? {} : { 'clerk.timeout_ms': timeoutMs }),
      },
    },
    async (span) => {
      let timer: NodeJS.Timeout | undefined
      try {
        const result =
          timeoutMs === null
            ? await op()
            : await Promise.race([
                op(),
                new Promise<never>((_, reject) => {
                  timer = setTimeout(
                    () => reject(new ClerkTimeoutError(timeoutMs)),
                    timeoutMs,
                  )
                }),
              ])
        span.setStatus({ code: SpanStatusCode.OK })
        return result
      } catch (err) {
        span.setAttribute('clerk.timed_out', err instanceof ClerkTimeoutError)
        span.recordException(err instanceof Error ? err : String(err))
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : String(err),
        })
        throw err
      } finally {
        clearTimeout(timer)
        span.end()
      }
    },
  )
