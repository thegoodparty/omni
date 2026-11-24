import { z } from 'zod'
import {
  ScaleToWinJobSchema,
  ScaleToWinJobStatusSchema,
} from './scaleToWinCampaign.schema'

export const S2W_CONTACT_CSV_UPLOAD_TYPE = 'CONTACT_CSV'
export const S2W_PHONE_NUMBER_COLUMN = 'cellPhone'
export const S2W_MAX_CSV_ROWS = 500_000

export const PresignedPutBodySchema = z.object({
  subaccountId: z.string(),
  type: z.literal(S2W_CONTACT_CSV_UPLOAD_TYPE),
  contentType: z.literal('text/csv'),
  fileName: z.string().min(1),
})
export type PresignedPutBody = z.infer<typeof PresignedPutBodySchema>

export const PresignedPutResponseSchema = z.object({
  signedPutUrl: z.string().url(),
  token: z.string().min(1),
})
export type PresignedPutResponse = z.infer<typeof PresignedPutResponseSchema>

export const CsvUploadBodySchema = z.object({
  uploadToken: z.string().min(1),
  estimatedRowCount: z.number().int().min(1).max(S2W_MAX_CSV_ROWS),
  phoneNumberColumn: z.literal(S2W_PHONE_NUMBER_COLUMN),
  contactFieldMapping: z.record(z.string(), z.string()),
})
export type CsvUploadBody = z.infer<typeof CsvUploadBodySchema>

export const CsvUploadResponseSchema = z.object({
  status: ScaleToWinJobStatusSchema,
})
export type CsvUploadResponse = z.infer<typeof CsvUploadResponseSchema>

export const ScaleToWinLoadResultSchema = z.object({
  nContacts: z.number().int(),
  nInvalid: z.number().int(),
  nDuplicates: z.number().int(),
  nOptOuts: z.number().int(),
  nNotSubscribed: z.number().int(),
  nLandlines: z.number().int(),
  nFilteredOut: z.number().int(),
  importedFieldNames: z.array(z.string()).nullish(),
})
export type ScaleToWinLoadResult = z.infer<typeof ScaleToWinLoadResultSchema>

export const ScaleToWinLoadJobSchema = ScaleToWinJobSchema.extend({
  result: ScaleToWinLoadResultSchema.nullish(),
})
export type ScaleToWinLoadJob = z.infer<typeof ScaleToWinLoadJobSchema>
