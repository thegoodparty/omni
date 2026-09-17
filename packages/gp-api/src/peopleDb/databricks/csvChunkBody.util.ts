import { PeopleDbxUnavailableError } from './peopleDbxStatement.client'

// A district is drained in many chunks and the whole read dies with any one of
// them, so the odds of losing it are the per-chunk failure rate multiplied by
// the chunk count -- a blip that would be invisible on a single request is
// close to routine across a 698,649-row scan. Three attempts rather than more
// because the failure this exists for is a stale pooled socket, which the
// immediate retry already resolves; anything still failing on the third go is
// not transient, and the caller is waiting.
const FETCH_ATTEMPTS = 3

// Linear, and short. A caller holds a whole pack build or CSV download open
// while this waits, so the budget is a fraction of the drain rather than the
// usual exponential ladder.
const BACKOFF_MS = 250

// Except against a throttle, which 250ms is far too short to clear: being told
// to slow down and then asking again almost immediately is how a rate limit
// becomes a longer rate limit.
const THROTTLED_BACKOFF_MS = 2_000

const TOO_MANY_REQUESTS = 429

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

// `err.message` on its own is "fetch failed", which names nothing. What made
// the prod incident diagnosable was the cause underneath it -- "other side
// closed" -- so it travels in the message as well as on `cause`, because the
// alert that pages on this reads the message.
const describeError = (err: unknown): string => {
  if (!(err instanceof Error)) return String(err)
  return err.cause instanceof Error
    ? `${err.message}: ${err.cause.message}`
    : err.message
}

// A chunk link is presigned, so the query string IS the authorization for a
// slice of the voter projection -- signature, credential and session token in
// the clear. `redactLine` does not catch them: its rule matches `token` and
// `key` only immediately after `?` or `&`, so `X-Amz-Security-Token` misses on
// the leading dash and `X-Amz-Signature` is not a name it knows at all.
//
// The TTL is not the reason to care. Log-read access is wider than voter-data
// access and log retention outlives any presigned window, so leaving it whole
// turns "can read logs" into "can read voter PII" -- on a line that fires
// exactly when people are grepping through an incident. The path still says
// which chunk this was, which is all the log needed it for.
const redactLink = (link: string): string => {
  try {
    const url = new URL(link)
    return `${url.origin}${url.pathname}`
  } catch {
    return '[unparseable link]'
  }
}

type RetryLogger = { warn: (obj: object, msg: string) => void }

// Download one chunk's body from its presigned link, retrying the ways it can
// fail in transit. Shared rather than owned by either caller: the pack build
// and the CSV download drain the same chunk chain the same way, and only one
// of them having learned to survive a lost socket is how the other one waits
// to be the next incident.
export const readCsvChunkBody = async (
  link: string,
  logger: RetryLogger,
): Promise<Buffer> => {
  let lastError: unknown
  let backoffMs = BACKOFF_MS

  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    if (attempt > 1) await delay(backoffMs * (attempt - 1))

    try {
      // The body read sits inside the try with the request, not after it.
      // undici raises a socket dying mid-request as "fetch failed" and one
      // dying while the body streams as "terminated", and the second is the
      // longer window of the two: a chunk is megabytes arriving across a drain
      // measured in tens of seconds, against milliseconds for the handshake.
      const response = await fetch(link)

      if (response.ok) {
        const body = Buffer.from(await response.arrayBuffer())
        if (attempt > 1) {
          // A retry that works is invisible otherwise, and whether the
          // per-chunk failure rate is holding steady or climbing is the thing
          // worth knowing BEFORE it exhausts the attempts and takes a pack
          // down again.
          logger.warn(
            { link: redactLink(link), attempt },
            'CSV chunk fetch recovered on retry',
          )
        }
        return body
      }

      lastError = new PeopleDbxUnavailableError(
        `CSV chunk fetch failed with ${response.status}`,
      )
      // A 5xx is the storage host having a moment and a 429 is it asking for
      // room; both are worth asking again. Any other 4xx is an answer -- most
      // often the ~15 minute presigned expiry, which no number of retries will
      // talk round, and a long multi-chunk drain can genuinely reach.
      if (response.status === TOO_MANY_REQUESTS) {
        backoffMs = THROTTLED_BACKOFF_MS
      } else if (response.status < 500) {
        break
      }
    } catch (err) {
      // A rejection is a transport failure rather than an answer: the socket
      // closed, DNS blipped, the TLS handshake died. Retried because the
      // common one here is a keep-alive race -- chunks are downloaded with a
      // parse in between, so a pooled connection sits idle long enough for the
      // host to close it while undici still believes it is open, and the next
      // request onto that socket fails as "other side closed".
      lastError = err
    }
  }

  // Classified, not bare: a plain Error escapes the pack's catch unlogged and
  // lands as a 500, which reads as a bug in the pack rather than the upstream
  // fetch failure it is.
  throw lastError instanceof PeopleDbxUnavailableError
    ? lastError
    : new PeopleDbxUnavailableError(
        `CSV chunk fetch failed: ${describeError(lastError)}`,
        { cause: lastError },
      )
}
