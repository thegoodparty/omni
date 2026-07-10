import { Injectable, NotFoundException } from '@nestjs/common'
import { formatISO } from 'date-fns'
import { z } from 'zod'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  OrdinanceAuthoritySchema,
  OrdinanceClarifyAnswersSchema,
  OrdinanceClarifySchema,
  OrdinanceComparablesSchema,
  OrdinanceExistingLawSchema,
  OrdinanceResearchSchema,
  OrdinanceScratchpadSchema,
  type OrdinanceClarify,
  type OrdinanceClarifyAnswer,
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

export interface CurrentCodeChapter {
  chapterLabel: string
  text: string
  citation: string
  stub: boolean
}

// DB helpers backing the ordinance_flow tools. Every method is scoped to a
// single (ordinanceId, electedOfficeId) so a tool call can only ever touch the
// ordinance the chat is anchored to. JSON columns are read-modify-write; within
// one chat turn the model runs tools sequentially, so no locking is needed.
@Injectable()
export class OrdinanceFlowToolsService extends createPrismaBase(
  MODELS.Ordinance,
) {
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

  async appendAnswer(
    ordinanceId: string,
    electedOfficeId: string,
    answer: OrdinanceClarifyAnswer,
  ): Promise<{ saved: true }> {
    const o = await this.findOwned(ordinanceId, electedOfficeId)
    const answers = parse(OrdinanceClarifyAnswersSchema, o.clarifyAnswers) ?? []
    // Replace an existing answer to the same question (a re-answer) rather than
    // appending a duplicate.
    const next = [
      ...answers.filter((a) => a.questionId !== answer.questionId),
      answer,
    ]
    await this.model.update({
      where: { id: o.id },
      data: { clarifyAnswers: next },
    })
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

  // Current municipal code for the ordinance's municipality. A cron will load
  // real code into `research.currentCode` (Collin, not built here); until that
  // contract lands this returns a labeled stub so the flow is exercisable.
  async getCurrentCode(
    ordinanceId: string,
    electedOfficeId: string,
    chapter?: string,
  ): Promise<CurrentCodeChapter> {
    await this.findOwned(ordinanceId, electedOfficeId)
    const label = chapter?.trim() || 'Municipal Code'
    return {
      chapterLabel: label,
      text:
        `No current code has been loaded for this municipality yet. ` +
        `Treat "${label}" as not-yet-available and rely on web search plus ` +
        `the user for existing-law context.`,
      citation: 'stub: current-code cron not yet wired',
      stub: true,
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
