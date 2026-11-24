import { z } from 'zod'
import {
  ScaleToWinCampaignStatusSchema,
  ScaleToWinJobStatusSchema,
  ScaleToWinScriptVariantSchema,
} from './scaleToWinCampaign.schema'
import { ScaleToWinLoadResultSchema } from './scaleToWinContacts.schema'

// `vendor_mock_record.kind` values for the Scale to Win mock. A campaign's
// externalId is its campaign id; an upload's is its upload token.
export const SCALE_TO_WIN_MOCK_KIND = {
  campaign: 'campaign',
  upload: 'upload',
} as const

export const ScaleToWinMockCampaignStateSchema = z.object({
  name: z.string(),
  status: ScaleToWinCampaignStatusSchema,
  scriptVariants: z.array(ScaleToWinScriptVariantSchema),
  sendingPhoneNumber: z.string(),
  contactFields: z.array(z.string()),
  textingHoursTimezone: z.string().nullable(),
  textingHoursStart: z.string().nullable(),
  textingHoursEnd: z.string().nullable(),
  startedAt: z.string().nullable(),
  loadJob: z
    .object({ status: ScaleToWinJobStatusSchema, rowCount: z.number().int() })
    .nullable(),
  // Set by a test to stand in for Scale to Win's skip counts.
  scriptedLoadResult: ScaleToWinLoadResultSchema.nullable(),
  startJob: z.object({ status: ScaleToWinJobStatusSchema }).nullable(),
})
export type ScaleToWinMockCampaignState = z.infer<
  typeof ScaleToWinMockCampaignStateSchema
>

export const ScaleToWinMockUploadStateSchema = z.object({
  fileName: z.string(),
  rowCount: z.number().int().nullable(),
})
export type ScaleToWinMockUploadState = z.infer<
  typeof ScaleToWinMockUploadStateSchema
>
