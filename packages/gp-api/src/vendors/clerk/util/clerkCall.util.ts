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
export const clerkCall = <T>(
  operation: string,
  attributes: Attributes,
  op: () => Promise<T>,
): Promise<T> =>
  tracer.startActiveSpan(
    `clerk.${operation}`,
    { attributes: { ...attributes, 'clerk.timeout_ms': CLERK_API_TIMEOUT_MS } },
    async (span) => {
      let timer: NodeJS.Timeout | undefined
      try {
        const result = await Promise.race([
          op(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new ClerkTimeoutError(CLERK_API_TIMEOUT_MS)),
              CLERK_API_TIMEOUT_MS,
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
