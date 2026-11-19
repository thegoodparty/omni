import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'
import { recordVendorSchemaMismatch } from './vendorSchema.metrics'

export type ParseVendorResponseOptions = {
  vendor: string
  // Path template, never the concrete URL (it becomes a metric label).
  endpoint: string
  // observe: log + count a mismatch and return the body untouched.
  // enforce: throw on a mismatch.
  mode: 'observe' | 'enforce'
  logger: PinoLogger
}

/**
 * Parses a vendor response body against its schema.
 *
 * In observe mode a mismatch never breaks the live call: it increments
 * `vendor_schema_mismatch_total` and logs each Zod issue's path, code, and
 * expected/received type at warn. Enforce mode does the same and then throws
 * the ZodError. No value from the body is ever logged, since it can carry PII
 * (EIN, email, phone).
 */
export const parseVendorResponse = <S extends z.ZodType>(
  schema: S,
  body: unknown,
  { vendor, endpoint, mode, logger }: ParseVendorResponseOptions,
): z.infer<S> => {
  // reportInput lets each issue carry the offending value so its type can be
  // logged; the value itself never leaves this function.
  const result = schema.safeParse(body, { reportInput: true })
  if (!result.success) {
    recordVendorSchemaMismatch(vendor, endpoint)
    logger.warn(
      {
        vendor,
        endpoint,
        issuePaths: result.error.issues.map((issue) => issue.path.join('.')),
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          expected: 'expected' in issue ? issue.expected : undefined,
          // A JSON body cannot hold undefined, so it means the key is absent.
          received:
            issue.input === undefined
              ? 'missing'
              : issue.input === null
                ? 'null'
                : Array.isArray(issue.input)
                  ? 'array'
                  : typeof issue.input,
        })),
      },
      'Vendor response did not match schema',
    )
  }
  // enforce counts and logs like observe, then fails the call, so a probe
  // that throws on a mismatch still feeds vendor_schema_mismatch_total. It
  // re-parses rather than throwing result.error, whose issues carry the body's
  // values (reportInput) and would reach whoever logs the thrown error.
  // Re-parse rather than read result.data: safeParse types it `T | undefined`.
  if (mode === 'enforce') return schema.parse(body)
  // WHY: observe mode returns the raw body even when valid (zod strips unknown
  // keys, which would change what callers got before schemas existed) and keeps
  // serving the live call on a mismatch, so the body is trusted as the schema type.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return body as z.infer<S>
}
