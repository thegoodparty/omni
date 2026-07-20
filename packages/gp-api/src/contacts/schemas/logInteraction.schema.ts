import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

// The request body is a discriminated union (@goodparty_org/contracts
// LogContactInteractionInputSchema) — nestjs-zod's createZodDto requires a
// single ZodObject, so the body is bound in the controller via
// `@Body(new ZodValidationPipe(schema))` instead of a DTO class (same
// pattern as UserAgendaFinalizeRequestSchema in src/meetings).
const logContactInteractionParamsSchema = z.object({
  personId: z.string().min(1),
})

export class LogContactInteractionParamsDTO extends createZodDto(
  logContactInteractionParamsSchema,
) {}
