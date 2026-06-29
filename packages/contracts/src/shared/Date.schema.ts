import { z } from 'zod'

// zod v4's z.toJSONSchema — which nestjs-zod v5 calls when NestJS builds the
// OpenAPI document at bootstrap (SwaggerModule.createDocument) — throws
// "Date cannot be represented in JSON Schema" for any ZodDate, and nestjs-zod
// offers no way to pass it `unrepresentable: 'any'`. The previous
// zod-to-json-schema rendered dates as { type: 'string', format: 'date-time' }.
// zod core consults a per-schema `_zod.toJSONSchema` hook before its (throwing)
// processor, so we attach that rendering here. Only the generated JSON Schema
// changes; runtime parsing is identical to the wrapped z.coerce.date()/z.date().
const withDateTimeJsonSchema = <T extends z.ZodType>(schema: T): T => {
  ;(schema._zod as unknown as { toJSONSchema: () => unknown }).toJSONSchema =
    () => ({ type: 'string', format: 'date-time' })
  return schema
}

// Drop-in replacements for z.coerce.date() / z.date() that keep identical
// runtime behavior but are representable in JSON Schema (see above).
export const zCoerceDate = () => withDateTimeJsonSchema(z.coerce.date())

export const zDate = () => withDateTimeJsonSchema(z.date())
