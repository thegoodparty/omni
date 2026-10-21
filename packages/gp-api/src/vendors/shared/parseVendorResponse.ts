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
 * `vendor_schema_mismatch_total` and logs the Zod issue paths at warn. The
 * body is never logged, since it can carry PII (EIN, email, phone).
 */
export const parseVendorResponse = <S extends z.ZodType>(
  schema: S,
  body: unknown,
  { vendor, endpoint, mode, logger }: ParseVendorResponseOptions,
): z.infer<S> => {
  if (mode === 'enforce') {
    return schema.parse(body)
  }
  const result = schema.safeParse(body)
  if (!result.success) {
    recordVendorSchemaMismatch(vendor, endpoint)
    logger.warn(
      {
        vendor,
        endpoint,
        issuePaths: result.error.issues.map((issue) => issue.path.join('.')),
      },
      'Vendor response did not match schema',
    )
  }
  // WHY: observe mode returns the raw body even when valid (zod strips unknown
  // keys, which would change what callers got before schemas existed) and keeps
  // serving the live call on a mismatch, so the body is trusted as the schema type.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return body as z.infer<S>
}
