import { Injectable, NotFoundException } from '@nestjs/common'
import { formatISO } from 'date-fns'
import { z } from 'zod'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { S3Service } from '@/vendors/aws/services/s3.service'
import {
  OrdinanceCodeResponseSchema,
  type OrdinanceCodeResponse,
} from '@/ordinances/schemas/getOrdinanceCode.schema'
import { OrdinanceArtifactSchema } from '@/ordinances/schemas/ordinanceArtifact.schema'
import {
  OrdinanceAuthoritySchema,
  OrdinanceClarifyAnswersSchema,
  OrdinanceClarifySchema,
  OrdinanceComparablesSchema,
  OrdinanceExistingLawSchema,
  OrdinanceResearchSchema,
  OrdinanceScratchpadSchema,
  type OrdinanceClarify,
} from '@goodparty_org/contracts'

export const ORDINANCE_READ_SECTIONS = [
  'clarify',
  'clarify_answers',
  'authority',
  'current_law',
  'comparables',
  'draft',
  'research',
  'scratchpad',
] as const
export type OrdinanceReadSection = (typeof ORDINANCE_READ_SECTIONS)[number]

export interface OrdinanceTocEntry {
  title: string
  number?: string
}

export type OrdinanceCodeSourceResult =
  | {
      available: true
      source: OrdinanceCodeResponse
      verifiedEvidence: string
      toc?: OrdinanceTocEntry[]
      guidance: string
    }
  | { available: false; reason: 'no_record'; guidance: string }

// DB helpers backing the ordinance_flow tools. Every method is scoped to a
// single (ordinanceId, electedOfficeId) so a tool call can only ever touch the
// ordinance the chat is anchored to. JSON columns are read-modify-write; within
// one chat turn the model runs tools sequentially, so no locking is needed.
@Injectable()
export class OrdinanceFlowToolsService extends createPrismaBase(
  MODELS.Ordinance,
) {
  constructor(private readonly s3: S3Service) {
    super()
  }

  private async findOwned(ordinanceId: string, electedOfficeId: string) {
    const ordinance = await this.model.findFirst({
      where: { id: ordinanceId, electedOfficeId, deletedAt: null },
    })
    if (!ordinance) {
      throw new NotFoundException('Ordinance not found')
    }
    return ordinance
  }

  async readSection(
    ordinanceId: string,
    electedOfficeId: string,
    section: OrdinanceReadSection,
  ): Promise<Record<string, unknown>> {
    const o = await this.findOwned(ordinanceId, electedOfficeId)
    switch (section) {
      case 'clarify':
        return { clarify: parse(OrdinanceClarifySchema, o.clarify) }
      case 'clarify_answers':
        return {
          clarifyAnswers:
            parse(OrdinanceClarifyAnswersSchema, o.clarifyAnswers) ?? [],
        }
      case 'authority':
        return { authority: parse(OrdinanceAuthoritySchema, o.authority) }
      case 'current_law':
        return { currentLaw: parse(OrdinanceExistingLawSchema, o.existingLaw) }
      case 'comparables':
        return {
          comparables: parse(OrdinanceComparablesSchema, o.comparables) ?? [],
        }
      case 'draft':
        return { draft: { title: o.draftTitle, body: o.draftBody } }
      case 'research':
        return { research: parse(OrdinanceResearchSchema, o.research) }
      case 'scratchpad':
        return {
          scratchpad: parse(OrdinanceScratchpadSchema, o.scratchpad) ?? [],
        }
    }
  }

  async appendNote(
    ordinanceId: string,
    electedOfficeId: string,
    step: string,
    text: string,
  ): Promise<{ saved: true }> {
    const o = await this.findOwned(ordinanceId, electedOfficeId)
    const scratchpad = parse(OrdinanceScratchpadSchema, o.scratchpad) ?? []
    scratchpad.push({ step, text, createdAt: formatISO(new Date()) })
    await this.model.update({ where: { id: o.id }, data: { scratchpad } })
    return { saved: true }
  }

  async saveSynthesis(
    ordinanceId: string,
    electedOfficeId: string,
    clarify: OrdinanceClarify,
  ): Promise<{ saved: true }> {
    const o = await this.findOwned(ordinanceId, electedOfficeId)
    await this.model.update({ where: { id: o.id }, data: { clarify } })
    return { saved: true }
  }

  async saveExistingLaw(
    ordinanceId: string,
    electedOfficeId: string,
    law: { sourceUrl: string; chapterLabel?: string; text: string },
  ): Promise<{ saved: true }> {
    const o = await this.findOwned(ordinanceId, electedOfficeId)
    const existingLaw = OrdinanceExistingLawSchema.parse({
      ...law,
      fetchedAt: formatISO(new Date()),
    })
    await this.model.update({ where: { id: o.id }, data: { existingLaw } })
    return { saved: true }
  }

  // Where the municipality's current code lives, from the OrdinanceCodeRecord
  // the find_existing_ordinances background agent verified. artifactBucket/
  // artifactKey/supersededNote stay internal (same redaction as the REST
  // endpoint) — tool results enter the persisted chat transcript.
  async getCodeSource(
    ordinanceId: string,
    electedOfficeId: string,
    organizationSlug: string,
  ): Promise<OrdinanceCodeSourceResult> {
    await this.findOwned(ordinanceId, electedOfficeId)
    const record = await this.client.ordinanceCodeRecord.findUnique({
      where: { organizationSlug },
    })
    // Degrade instead of throwing: a thrown tool error kills the SSE stream.
    // The record is our own row, so a parse miss means schema drift, not user
    // input — surface it as unavailable and log for follow-up.
    const parsed = record ? OrdinanceCodeResponseSchema.safeParse(record) : null
    if (!record || !parsed?.success) {
      if (record) {
        this.logger.warn(
          { organizationSlug, err: parsed?.error },
          'OrdinanceCodeRecord failed response-schema parse',
        )
      }
      return {
        available: false,
        reason: 'no_record',
        guidance:
          'No verified code source is on file for this municipality yet. ' +
          'Use web_search to locate the municipal code, and ask the user to ' +
          'confirm the source before relying on it.',
      }
    }
    const toc = await this.readArtifactToc(
      record.artifactBucket,
      record.artifactKey,
      organizationSlug,
    )
    return {
      available: true,
      source: parsed.data,
      verifiedEvidence: record.verifiedEvidence,
      ...(toc && { toc }),
      guidance:
        'Route on dataQuality, not on url presence: a found:false or ' +
        'uncodified result can still carry a pointer to where ordinances ' +
        'live. Use fetch_url to read specific chapters from the source url.',
    }
  }

  private async readArtifactToc(
    bucket: string,
    key: string,
    organizationSlug: string,
  ): Promise<OrdinanceTocEntry[] | null> {
    try {
      const raw = await this.s3.getFile(bucket, key)
      if (!raw) return null
      const artifact = OrdinanceArtifactSchema.safeParse(JSON.parse(raw))
      if (!artifact.success || !artifact.data.toc?.length) return null
      return artifact.data.toc
    } catch (err) {
      this.logger.warn(
        { err, organizationSlug },
        'Failed to read ordinance code artifact for toc',
      )
      return null
    }
  }
}

// Defensively parse an untyped JSON column; a mismatch degrades to null. V is
// inferred from the column so the untyped value is never named.
const parse = <S extends z.ZodType, V>(
  schema: S,
  value: V,
): z.infer<S> | null => {
  if (value === null || value === undefined) return null
  const result = schema.safeParse(value)
  return result.success ? result.data : null
}
