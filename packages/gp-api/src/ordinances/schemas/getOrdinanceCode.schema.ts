import { z } from 'zod'
import { zDate } from '@goodparty_org/contracts'
import {
  OrdinanceConfidence,
  OrdinanceDataQuality,
  OrdinanceHostType,
} from '@/generated/prisma'

// artifactBucket/artifactKey are internal S3 pointers — never exposed; the
// response interceptor strips them by parsing through this schema.
// supersededNote is likewise omitted: it is ops-grade content exposing
// internal run ids, kept in the DB but never returned to the webapp.
// Prisma enums are SCREAMING_CASE; the webapp-facing convention is lowercase,
// so each enum is lowered on the way out.
export const OrdinanceCodeResponseSchema = z.object({
  codeFound: z.boolean(),
  dataQuality: z
    .nativeEnum(OrdinanceDataQuality)
    .transform((v) => v.toLowerCase()),
  confidence: z
    .nativeEnum(OrdinanceConfidence)
    .transform((v) => v.toLowerCase()),
  hostType: z
    .nativeEnum(OrdinanceHostType)
    .nullable()
    .transform((v) => (v === null ? null : v.toLowerCase())),
  url: z.string().nullable(),
  editionOrDate: z.string().nullable(),
  place: z.string(),
  state: z.string(),
  verifiedAt: zDate(),
})
