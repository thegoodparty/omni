import { faro, LogLevel } from '@grafana/faro-web-sdk'
import { isMissingSessionError } from 'gpApi/unauthorized'

const faroContext = (
  customAttributes?: Partial<Record<string, unknown>>,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(customAttributes ?? {}).map(([key, value]) => [
      key,
      typeof value === 'string' ? value : (JSON.stringify(value) ?? ''),
    ]),
  )

export const reportClientError = (
  error: unknown,
  customAttributes?: Partial<Record<string, unknown>>,
) => {
  // A request that went out without a session is a signed-out state, not a
  // defect in what we shipped: the request layer already sends the user to sign
  // in (gpApi/unauthorized.ts), and reporting it here filed a "new front-end
  // error" alert each time a session Clerk had ended surfaced as a failed fetch
  // (ENG-11674). A 401 a route raises with a live session is still reported.
  if (isMissingSessionError(error)) return

  const reportable =
    error instanceof Error
      ? error
      : new Error(typeof error === 'string' ? error : JSON.stringify(error))
  // `faro.api` exists only once instrumentation-client.ts has initialized
  // Faro, which it skips where no collector is configured and in automated
  // browsers.
  faro.api?.pushError(reportable, { context: faroContext(customAttributes) })
}

/**
 * A failure the browser raised about something we asked it for, which no change
 * of ours can prevent: a dropped connection, not a defect in our code. It goes
 * to Faro as a log line, never as an exception, because the exception stream is
 * what the front-end error alerts page on and a dropped socket is not an error
 * anyone can fix (ENG-11724).
 */
export const reportClientInterruption = (
  message: string,
  customAttributes?: Partial<Record<string, unknown>>,
) => {
  faro.api?.pushLog([message], {
    level: LogLevel.WARN,
    context: faroContext(customAttributes),
  })
}
