import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

const checkPhoneListStatusResponseSchema = z.object({
  phoneListId: z.number(),
  leadsLoaded: z.number(),
  // From the capture row (ENG-10800/ENG-10801), so ENG-10808's purchase
  // review can explain why leadsLoaded is smaller than the saved list's raw
  // membership.
  excludedOptedOutCount: z.number(),
  excludedDuplicatePhoneCount: z.number(),
})

export class CheckPhoneListStatusResponseDto extends createZodDto(
  checkPhoneListStatusResponseSchema,
) {}

export type CheckPhoneListStatusAcceptedResponseDto = {
  message: string
}
