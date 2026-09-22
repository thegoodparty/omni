import { z } from 'zod'
import { RecommendedListVariantSchema } from '@goodparty_org/contracts'

export const DownloadRecommendedListParamsSchema = z.object({
  variant: RecommendedListVariantSchema,
})

export type DownloadRecommendedListParams = z.infer<
  typeof DownloadRecommendedListParamsSchema
>
