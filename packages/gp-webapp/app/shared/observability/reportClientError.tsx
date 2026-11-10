import { faro } from '@grafana/faro-web-sdk'

export const reportClientError = (
  error: unknown,
  customAttributes?: Partial<Record<string, unknown>>,
) => {
  const reportable =
    error instanceof Error
      ? error
      : new Error(typeof error === 'string' ? error : JSON.stringify(error))
  // `faro.api` exists only once instrumentation-client.ts has initialized
  // Faro, which it skips where no collector is configured and in automated
  // browsers.
  faro.api?.pushError(reportable, {
    context: Object.fromEntries(
      Object.entries(customAttributes ?? {}).map(([key, value]) => [
        key,
        typeof value === 'string' ? value : (JSON.stringify(value) ?? ''),
      ]),
    ),
  })
}
