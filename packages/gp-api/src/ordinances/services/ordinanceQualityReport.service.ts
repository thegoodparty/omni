import { createHash } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { z } from 'zod'
import {
  type OrdinanceQualityReport,
  type OrdinanceSource,
} from '@goodparty_org/contracts'
import { LlmService } from '@/llm/services/llm.service'
import { Ordinance } from '../../generated/prisma'

// Sensitive: the draft and its constituent-derived rationale go into the model
// context, so QC runs Claude-only.
const QC_MODELS = ['claude-sonnet-4-6', 'claude-opus-4-7']

// The six fixed rubric checks. Labels and order are fixed here so the rubric
// can't drift; the model only supplies each check's status, note, and source.
const QC_CHECKS = [
  { id: 'authority', label: 'Authority' },
  { id: 'legal_conflict', label: 'Legal conflict' },
  { id: 'precedent_grounding', label: 'Precedent grounding' },
  { id: 'completeness', label: 'Completeness' },
  { id: 'clarity', label: 'Clarity' },
  { id: 'voice', label: 'Voice' },
] as const

// Tolerant of model variance so one off field (an unexpected status, a source
// missing an id or with a non-URL link) degrades that field instead of failing
// the whole parse and 500ing. Everything is normalized to the fixed rubric and
// a valid OrdinanceSource in assembleChecks below.
const QcGenerationSourceSchema = z
  .object({
    id: z.string().optional(),
    title: z.string(),
    url: z.string().optional(),
    publisher: z.string().optional(),
    excerpt: z.string().optional(),
  })
  .optional()
  .catch(undefined)

const QcGenerationSchema = z.object({
  // `.catch([])` on the array too: if the model omits `checks` or returns a
  // non-array, degrade to an empty list (assembleChecks then fills all six with
  // the 'attention' fallback) rather than throwing and 500ing the request.
  checks: z
    .array(
      z.object({
        id: z.string(),
        status: z.enum(['pass', 'flag', 'attention']).catch('attention'),
        note: z.string().catch('').optional(),
        source: QcGenerationSourceSchema,
      }),
    )
    .catch([]),
})

type QcGeneratedCheck = z.infer<typeof QcGenerationSchema>['checks'][number]

const normalizeSource = (
  raw: QcGeneratedCheck['source'],
  checkId: string,
): OrdinanceSource | undefined => {
  if (!raw) return undefined
  const url =
    raw.url && z.string().url().safeParse(raw.url).success ? raw.url : undefined
  return {
    id: raw.id && raw.id.length > 0 ? raw.id : `${checkId}-source`,
    title: raw.title,
    ...(url ? { url } : {}),
    ...(raw.publisher ? { publisher: raw.publisher } : {}),
    ...(raw.excerpt ? { excerpt: raw.excerpt } : {}),
  }
}

// Hash the full text the report is graded against (title + body), so a
// title-only edit also marks the report stale. Used both when stamping a fresh
// report and when deriving staleness on read, so the two must stay identical.
export const qualityReportInputHash = (
  record: Pick<Ordinance, 'draftTitle' | 'draftBody'>,
): string =>
  createHash('sha256')
    .update(`${record.draftTitle ?? ''}\n${record.draftBody ?? ''}`)
    .digest('hex')

const QC_SYSTEM_PROMPT = [
  'You are a legislative drafting reviewer. Evaluate a municipal ordinance',
  'draft against a fixed six-check quality rubric for the elected official who',
  'wrote it. Be a rigorous but fair reviewer; ground every judgment in the',
  'draft text and the prior-step material provided, and never invent facts,',
  'statutes, or citations.',
  '',
  'Return one result for each of these six checks, by id:',
  '- authority: does the council have the legal power to enact this? Lean on the',
  '  authority finding provided.',
  '- legal_conflict: does the draft conflict with higher law or the existing',
  '  code? Lean on the current-law material.',
  '- precedent_grounding: is the approach grounded in how comparable',
  '  jurisdictions handled this? Lean on the comparables provided.',
  '- completeness: does the draft cover the essentials (definitions,',
  '  enforcement, effective date, scope) with no obvious gaps or unresolved',
  '  placeholders?',
  '- clarity: is the text clear, unambiguous, and well structured?',
  '- voice: is it in plain, governance-focused municipal-code style, addressed',
  '  to constituents (not campaign or political framing)?',
  '',
  'For each check set status to: pass (solid), flag (a real problem to fix), or',
  'attention (worth a look, not clearly wrong). Write the note as a short,',
  'actionable prompt the user can act on to improve the draft. Where a judgment',
  'rests on a specific provided source (an authority citation, a comparable, a',
  'current-law reference), attach that source; omit the source when the check is',
  'about the draft text itself.',
].join('\n')

const section = (label: string, value: unknown): string => {
  if (value === null || value === undefined) return ''
  const text =
    typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return text.trim().length === 0 ? '' : `## ${label}\n${text}`
}

const buildQcUserPrompt = (record: Ordinance): string =>
  [
    section('Goal', record.goalText),
    section('Draft title', record.draftTitle),
    section('Draft body', record.draftBody),
    section('Authority finding', record.authority),
    section('Current law', record.existingLaw),
    section('Comparables', record.comparables),
    section('Clarifying answers', record.clarifyAnswers),
  ]
    .filter((s) => s.length > 0)
    .join('\n\n')

@Injectable()
export class OrdinanceQualityReportService {
  constructor(private readonly llm: LlmService) {}

  async generate(
    record: Ordinance,
    userId: number,
  ): Promise<OrdinanceQualityReport> {
    const { object } = await this.llm.jsonCompletion({
      messages: [
        { role: 'system', content: QC_SYSTEM_PROMPT },
        { role: 'user', content: buildQcUserPrompt(record) },
      ],
      schema: QcGenerationSchema,
      models: QC_MODELS,
      userId: String(userId),
    })

    const byId = new Map(object.checks.map((c) => [c.id, c]))
    const checks = QC_CHECKS.map(({ id, label }) => {
      const generated = byId.get(id)
      const source = normalizeSource(generated?.source, id)
      const note = generated?.note?.trim()
      return {
        id,
        label,
        status: generated?.status ?? 'attention',
        note:
          note && note.length > 0 ? note : 'This check could not be evaluated.',
        ...(source ? { source } : {}),
      }
    })

    return {
      checks,
      tally: {
        pass: checks.filter((c) => c.status === 'pass').length,
        flag: checks.filter((c) => c.status === 'flag').length,
        attention: checks.filter((c) => c.status === 'attention').length,
      },
      stale: false,
      ranAgainstBodyHash: qualityReportInputHash(record),
    }
  }
}
