import { z } from 'zod'
import { zDate } from '@goodparty_org/contracts'
import {
  OrdinanceConfidence,
  OrdinanceDataQuality,
  OrdinanceHostType,
} from '@/generated/prisma'

// artifactBucket/artifactKey are internal S3 pointers — never exposed; the
// response interceptor strips them by parsing through this schema.
export const OrdinanceCodeResponseSchema = z.object({
  codeFound: z.boolean(),
  dataQuality: z.nativeEnum(OrdinanceDataQuality),
  confidence: z.nativeEnum(OrdinanceConfidence),
  hostType: z.nativeEnum(OrdinanceHostType).nullable(),
  url: z.string().nullable(),
  editionOrDate: z.string().nullable(),
  place: z.string(),
  state: z.string(),
  verifiedAt: zDate(),
  supersededNote: z.string().nullable(),
})
