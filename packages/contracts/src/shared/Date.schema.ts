import { z } from 'zod'

// zod v4's z.toJSONSchema throws "Date cannot be represented in JSON Schema"
// for any ZodDate, which breaks callers that render a contract schema to JSON
// Schema without passing `unrepresentable: 'any'` (notably the Gemini
// structured-output path in gp-api). zod core consults a per-schema
// `_zod.toJSONSchema` hook before its (throwing) processor, so we attach the
// { type: 'string', format: 'date-time' } rendering here. Only the generated
// JSON Schema changes; runtime parsing is identical to the wrapped
// z.coerce.date()/z.date().
const withDateTimeJsonSchema = <T extends z.ZodType>(schema: T): T => {
  ;(schema._zod as unknown as { toJSONSchema: () => unknown }).toJSONSchema =
    () => ({ type: 'string', format: 'date-time' })
  return schema
}

// Drop-in replacements for z.coerce.date() / z.date() that keep identical
// runtime behavior but are representable in JSON Schema (see above).
export const zCoerceDate = () => withDateTimeJsonSchema(z.coerce.date())

export const zDate = () => withDateTimeJsonSchema(z.date())
