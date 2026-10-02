import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

// GET /accounts/{account_id}/balance. Peerly also returns the identity's
// TCR status here; only the money fields are read.
const accountBalanceResponseSchema = z.object({
  balance: z.number(),
  credit_limit: z.number(),
})

export class AccountBalanceResponseDto extends createZodDto(
  accountBalanceResponseSchema,
) {}
