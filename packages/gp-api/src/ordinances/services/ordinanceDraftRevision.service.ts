import { Injectable } from '@nestjs/common'
import { z } from 'zod'
import {
  OrdinanceAuthoritySchema,
  OrdinanceComparablesSchema,
  OrdinanceSourceSchema,
  type OrdinanceQualityCheck,
  type OrdinanceSource,
} from '@goodparty_org/contracts'
import { LlmService } from '@/llm/services/llm.service'
import { Ordinance } from '../../generated/prisma'
import {
  QUALITY_LOOP_LLM_RETRIES,
  QUALITY_LOOP_MODELS,
} from '../ordinances.constants'

export class OrdinanceRevisionGuardError extends Error {}

export interface OrdinanceDraftRevision {
  title: string
  body: string
  revisions: { checkId: string; note: string }[]
  sourcesToAdd: OrdinanceSource[]
  tokens: number
}

const REVISION_MAX_TOKENS = 8192

// A revised body under half the previous length means the reviser gutted the
// draft rather than fixing the flagged checks; the caller retries once.
const MIN_BODY_RATIO = 0.5

// Strict on purpose: a malformed revision must fail the call, never overwrite
// a good draft the way the QC parse degrades.
const RevisionSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  revisions: z.array(z.object({ checkId: z.string(), note: z.string() })),
  sourceIdsToAdd: z.array(z.string()).optional(),
})

const REVISION_SYSTEM_PROMPT = [
  'You are a legislative drafting editor, not an author. You revise a',
  'municipal ordinance draft to fix specific flagged quality checks, and',
  'nothing else.',
  '',
  'Rules:',
  '- Fix only the flagged checks listed. Each note is an actionable work',
  '  order; address it directly.',
  '- Ground every fix in the provided prior-step material (authority finding,',
  '  current law, comparables, clarifying answers). Never invent statutes,',
  '  citations, or facts. If a flag cannot be fixed from the provided',
  "  material, leave that section unchanged and say so in that check's",
  '  revision note.',
  "- Copy untouched sections verbatim. Preserve the draft's structure,",
  '  numbering, the meaning of passing sections, its municipal-code voice,',
  '  and any bracketed [placeholder] policy decisions.',
  '- Output the complete revised title and body, plus one short note per',
  '  flagged check describing what you changed (or why you could not).',
  "- If a fix leans on a provided source, echo that source's id in",
  '  sourceIdsToAdd. Only use ids of sources already present in the provided',
  '  material.',
].join('\n')

const section = (label: string, value: unknown): string => {
  if (value === null || value === undefined) return ''
  const text =
    typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return text.trim().length === 0 ? '' : `## ${label}\n${text}`
}

const flaggedChecksSection = (checks: OrdinanceQualityCheck[]): string =>
  [
    '## Flagged checks',
    ...checks.map((check) =>
      [
        `- ${check.id} (${check.label}): ${check.note}`,
        ...(check.source ? [`  Source: ${JSON.stringify(check.source)}`] : []),
      ].join('\n'),
    ),
  ].join('\n')

const buildRevisionUserPrompt = (
  record: Ordinance,
  flaggedChecks: OrdinanceQualityCheck[],
): string =>
  [
    section('Goal', record.goalText),
    section('Draft title', record.draftTitle),
    section('Draft body', record.draftBody),
    section('Authority finding', record.authority),
    section('Current law', record.existingLaw),
    section('Comparables', record.comparables),
    section('Clarifying answers', record.clarifyAnswers),
    flaggedChecksSection(flaggedChecks),
  ]
    .filter((s) => s.length > 0)
    .join('\n\n')

const onRecordSourcesById = (
  record: Ordinance,
): Map<string, OrdinanceSource> => {
  const sources = new Map<string, OrdinanceSource>()
  const add = (source: OrdinanceSource) => {
    if (!sources.has(source.id)) sources.set(source.id, source)
  }
  const authority = OrdinanceAuthoritySchema.safeParse(record.authority)
  if (authority.success) add(authority.data.source)
  const comparables = OrdinanceComparablesSchema.safeParse(record.comparables)
  if (comparables.success) {
    comparables.data.forEach((comparable) => add(comparable.source))
  }
  const draftSources = z
    .array(OrdinanceSourceSchema)
    .safeParse(record.draftSources)
  if (draftSources.success) draftSources.data.forEach(add)
  return sources
}

@Injectable()
export class OrdinanceDraftRevisionService {
  constructor(private readonly llm: LlmService) {}

  async revise(
    record: Ordinance,
    flaggedChecks: OrdinanceQualityCheck[],
    opts?: { abortSignal?: AbortSignal },
  ): Promise<OrdinanceDraftRevision> {
    const { object, tokens } = await this.llm.jsonCompletion({
      messages: [
        { role: 'system', content: REVISION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildRevisionUserPrompt(record, flaggedChecks),
        },
      ],
      schema: RevisionSchema,
      models: QUALITY_LOOP_MODELS,
      retries: QUALITY_LOOP_LLM_RETRIES,
      maxTokens: REVISION_MAX_TOKENS,
      abortSignal: opts?.abortSignal,
    })

    const previousLength = record.draftBody?.length ?? 0
    if (object.body.length < previousLength * MIN_BODY_RATIO) {
      throw new OrdinanceRevisionGuardError(
        'revised body shrank below half the previous draft',
      )
    }

    const byId = onRecordSourcesById(record)
    const sourcesToAdd = [...new Set(object.sourceIdsToAdd ?? [])].flatMap(
      (id) => {
        const source = byId.get(id)
        return source ? [source] : []
      },
    )

    return {
      title: object.title,
      body: object.body,
      revisions: object.revisions,
      sourcesToAdd,
      tokens,
    }
  }
}
