import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

const param = z.string().min(1).max(255).optional()

export const SignupAttributionSchema = z.object({
  utm_source: param,
  utm_medium: param,
  utm_campaign: param,
  utm_term: param,
  utm_content: param,
  gclid: param,
  fbclid: param,
})

export type SignupAttribution = z.infer<typeof SignupAttributionSchema>

export class SubmitCrmRegistrationSchema extends createZodDto(
  SignupAttributionSchema.extend({ hutk: param }),
) {}
