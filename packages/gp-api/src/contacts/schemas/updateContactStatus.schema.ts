import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

// The request body is a discriminated union (@goodparty_org/contracts
// UpdateContactStatusInputSchema) — nestjs-zod's createZodDto requires a
// single ZodObject, so the body is bound in the controller via
// `@Body(new ZodValidationPipe(schema))` instead of a DTO class (same
// pattern as LogContactInteractionInputSchema in logInteraction.schema.ts).
const updateContactStatusParamsSchema = z.object({
  personId: z.guid(),
})

export class UpdateContactStatusParamsDTO extends createZodDto(
  updateContactStatusParamsSchema,
) {}
