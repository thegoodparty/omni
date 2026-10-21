import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import { PhoneListState } from '../peerly.types'

const uploadPhoneListResponseSchema = z.object({
  Data: z.object({
    token: z.string(),
    account_id: z.string().optional(),
    list_name: z.string().optional(),
    list_state: z.string().optional(),
    pending_list_id: z.number().optional(),
  }),
})

const phoneListStatusResponseSchema = z.object({
  Data: z.object({
    list_status: z.string().optional(),
    list_state: z.nativeEnum(PhoneListState).optional(),
    list_id: z.number().optional(),
  }),
})

// listByAccount answers with every list in the identity and far more
// columns than any caller needs; only the ones that identify a list and
// say whether it is usable are parsed, so a vendor column change can't
// break a read. list_id comes back as a number today, but coercion keeps
// a stringified id from failing validation.
const phoneListSummarySchema = z.object({
  list_id: z.coerce.number(),
  list_name: z.string().optional(),
  list_state: z.string().optional(),
  suppress_cell_phones: z.coerce.number().optional(),
})

const phoneListSummaryListSchema = z.array(phoneListSummarySchema)

const phoneListDetailsResponseSchema = z.object({
  leads_duplicate: z.number(),
  leads_master_dnc: z.number(),
  leads_cell_dnc: z.number(),
  leads_malformed: z.number(),
  leads_loaded: z.number(),
  use_nat_dnc: z.number(),
  suppress_cell_phones: z.number(),
  account_id: z.string(),
  leads_acct_dnc: z.number(),
  list_name: z.string(),
  list_state: z.nativeEnum(PhoneListState),
  list_id: z.number(),
  leads_cell_suppressed: z.number(),
  leads_supplied: z.number(),
  leads_invalid: z.number(),
  leads_nat_dnc: z.number(),
  upload_by: z.string(),
  shared: z.number(),
  upload_date: z.string(),
})

export class UploadPhoneListResponseDto extends createZodDto(
  uploadPhoneListResponseSchema,
) {}
export class PhoneListStatusResponseDto extends createZodDto(
  phoneListStatusResponseSchema,
) {}
export class PhoneListDetailsResponseDto extends createZodDto(
  phoneListDetailsResponseSchema,
) {}
export class PhoneListSummaryListDto extends createZodDto(
  phoneListSummaryListSchema,
) {}

export type PhoneListSummary = z.infer<typeof phoneListSummarySchema>
