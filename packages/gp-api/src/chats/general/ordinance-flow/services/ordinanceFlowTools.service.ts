import { Injectable, NotFoundException } from '@nestjs/common'
import { formatISO } from 'date-fns'
import { z } from 'zod'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { OrdinanceQualityLoopService } from '@/ordinances/services/ordinanceQualityLoop.service'
import { Ordinance, OrdinanceQualityLoopStatus } from '@/generated/prisma'
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
  OrdinanceSourceSchema,
  type OrdinanceAuthority,
  type OrdinanceClarify,
  type OrdinanceComparables,
  type OrdinanceSource,
} from '@goodparty_org/contracts'

import { estimateCostUsd } from '@/ordinances/services/ordinanceCost.util'
import { checkAmendmentFidelity } from '@/ordinances/services/ordinanceFidelity.util'

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
  constructor(
    private readonly s3: S3Service,
    private readonly qualityLoop: OrdinanceQualityLoopService,
  ) {
    super()
  }

  // Chat-tool writes to the quality-report hash inputs invalidate a running
  // background loop, same as the PATCH editor path.
  private async supersedeRunningLoop(ordinance: Ordinance): Promise<void> {
    if (ordinance.qualityLoopStatus === OrdinanceQualityLoopStatus.running) {
      await this.qualityLoop.supersedeOnEdit(ordinance.id)
    }
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
        // No complete draft → null, matching every other section's unsaved
        // signal. Either field null (e.g. a partial PATCH set only the title)
        // is not a valid draft; returning it would surprise `draft !== null`
        // consumers and feed nulls into the re-draft prompt.
        if (o.draftTitle === null || o.draftBody === null) {
          return { draft: null }
        }
        return {
          draft: {
            title: o.draftTitle,
            body: o.draftBody,
            sources:
              parse(z.array(OrdinanceSourceSchema), o.draftSources) ?? [],
          },
        }
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

  // Accumulate a turn's token usage onto the ordinance's flow counters and log
  // the per-turn line with a derived cost. Atomic increment (concurrent step
  // turns can't lose counts), scoped to the owning office; a non-owned or
  // deleted row is a no-op so metering never disturbs the turn.
  async recordFlowUsage(args: {
    ordinanceId: string
    electedOfficeId: string
    step: string
    model: string
    inputTokens: number
    outputTokens: number
  }): Promise<void> {
    const updated = await this.model.updateMany({
      where: {
        id: args.ordinanceId,
        electedOfficeId: args.electedOfficeId,
        deletedAt: null,
      },
      data: {
        flowInputTokens: { increment: args.inputTokens },
        flowOutputTokens: { increment: args.outputTokens },
      },
    })
    if (updated.count === 0) return
    const turnCostUsd = estimateCostUsd(
      args.model,
      args.inputTokens,
      args.outputTokens,
    )
    this.logger.info(
      {
        ordinanceId: args.ordinanceId,
        step: args.step,
        model: args.model,
        inputTokens: args.inputTokens,
        outputTokens: args.outputTokens,
        turnCostUsd: Number(turnCostUsd.toFixed(4)),
      },
      'ordinance flow turn usage',
    )
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

  async saveAuthority(
    ordinanceId: string,
    electedOfficeId: string,
    authority: OrdinanceAuthority,
  ): Promise<{ saved: true }> {
    const o = await this.findOwned(ordinanceId, electedOfficeId)
    // Write first: superseding is a write-once terminal, so flipping it
    // before a write that then fails would strand the loop dead with the
    // edit never persisted. The loop's own fenced writes tolerate the
    // reverse race (a draft write bumps @updatedAt → redelivery re-checks).
    await this.model.update({ where: { id: o.id }, data: { authority } })
    await this.supersedeRunningLoop(o)
    return { saved: true }
  }

  async saveComparables(
    ordinanceId: string,
    electedOfficeId: string,
    comparables: OrdinanceComparables,
  ): Promise<{ saved: true }> {
    const o = await this.findOwned(ordinanceId, electedOfficeId)
    await this.model.update({ where: { id: o.id }, data: { comparables } })
    await this.supersedeRunningLoop(o)
    return { saved: true }
  }

  // The draft owns dedicated columns (draftTitle/draftBody/draftSources).
  // Persisting the first draft advances the ordinance from `in_progress` to
  // `draft`, but never DOWNGRADES: re-drafting a record that already advanced
  // (in_review/proposed/...) keeps its current status. description is
  // render-only and lives in the tool args, not a column. Sources are written
  // only when non-empty: a regeneration that re-emits `[]` (readSection's
  // sourceless default) must not wipe citations a prior draft saved.
  async saveDraft(
    ordinanceId: string,
    electedOfficeId: string,
    draft: { title: string; body: string; sources?: OrdinanceSource[] },
  ): Promise<{ saved: true }> {
    const o = await this.findOwned(ordinanceId, electedOfficeId)
    const updated = await this.model.update({
      where: { id: o.id },
      data: {
        draftTitle: draft.title,
        draftBody: draft.body,
        ...(o.status === 'in_progress' && { status: 'draft' as const }),
        ...(draft.sources &&
          draft.sources.length > 0 && { draftSources: draft.sources }),
      },
      include: { electedOffice: true },
    })
    // Deterministic amend-fidelity check: when the verbatim current law is on
    // file, warn if the draft's redline misrepresents it (paraphrased, omitted,
    // or invented "existing" text). Non-blocking; observable in logs.
    const currentLaw = OrdinanceExistingLawSchema.safeParse(o.existingLaw)
    if (currentLaw.success && currentLaw.data.verbatimText) {
      const fidelity = checkAmendmentFidelity(
        draft.body,
        currentLaw.data.verbatimText,
      )
      if (!fidelity.ok) {
        this.logger.warn(
          {
            ordinanceId: o.id,
            verbatimBaseline: fidelity.baseline,
            draftClaimsOriginal: fidelity.reconstructed,
          },
          'amendment redline drifts from the verbatim current law',
        )
      }
    }
    // Fire-and-forget: the chat turn must never block on or fail with the
    // background loop. start() itself supersedes and restarts a running loop
    // for a re-draft, and guards flag/env/status/redline internally.
    void this.qualityLoop
      .start({
        ordinance: updated,
        userId: updated.electedOffice.userId,
        trigger: 'auto',
      })
      .catch((err: unknown) =>
        this.logger.error(
          { ordinanceId: o.id, error: err },
          'quality loop auto-start failed after saveDraft',
        ),
      )
    return { saved: true }
  }

  async saveExistingLaw(
    ordinanceId: string,
    electedOfficeId: string,
    law: {
      sourceUrl: string
      chapterLabel?: string
      text: string
      verbatimText?: string
    },
  ): Promise<{ saved: true }> {
    const o = await this.findOwned(ordinanceId, electedOfficeId)
    const existingLaw = OrdinanceExistingLawSchema.parse({
      ...law,
      fetchedAt: formatISO(new Date()),
    })
    await this.model.update({ where: { id: o.id }, data: { existingLaw } })
    await this.supersedeRunningLoop(o)
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
