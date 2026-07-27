import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import {
  OrdinanceAuthoritySchema,
  OrdinanceClarifyAnswersSchema,
  OrdinanceComparablesSchema,
  OrdinanceExistingLawSchema,
  OrdinanceQualityReportSchema,
  OrdinanceSeedTypeSchema,
  OrdinanceSourceSchema,
  type OrdinanceFlowStep,
} from '@goodparty_org/contracts'

// Records captured from real ordinance-flow sessions (dev, 2026-07-18) — the
// eval test set's raw material. Each JSON in records/ is a full end-state;
// deriveStepEntry strips it back to what existed when a given step began, so
// one captured session yields an entry fixture for every step.
export const ORDINANCE_FIXTURE_NAMES = [
  'shade-trees',
  'bike-parking',
  'bike-parking-redraft',
  'oil-spill',
  'oil-spill-early',
  'rent-cap-spokane',
] as const
export type OrdinanceFixtureName = (typeof ORDINANCE_FIXTURE_NAMES)[number]

const OrdinanceFixtureSchema = z.object({
  name: z.string(),
  seedType: OrdinanceSeedTypeSchema,
  issueSlug: z.string().nullable(),
  goalText: z.string().nullable(),
  clarifyAnswers: OrdinanceClarifyAnswersSchema.nullable(),
  authority: OrdinanceAuthoritySchema.nullable(),
  comparables: OrdinanceComparablesSchema.nullable(),
  existingLaw: OrdinanceExistingLawSchema.nullable(),
  draftTitle: z.string().nullable(),
  draftBody: z.string().nullable(),
  draftSources: z.array(OrdinanceSourceSchema).nullable(),
  qualityReport: OrdinanceQualityReportSchema.nullable(),
})
export type OrdinanceFixture = z.infer<typeof OrdinanceFixtureSchema>

export const loadOrdinanceFixture = (
  name: OrdinanceFixtureName,
): OrdinanceFixture =>
  OrdinanceFixtureSchema.parse(
    JSON.parse(
      readFileSync(join(__dirname, 'records', `${name}.json`), 'utf8'),
    ),
  )

type NullableFixtureField = {
  [K in keyof OrdinanceFixture]: null extends OrdinanceFixture[K] ? K : never
}[keyof OrdinanceFixture]

// Which fixture fields each step produces. Entry to a step = the record with
// that step's outputs and every later step's outputs stripped, exactly the
// state the agent sees when the step's conversation starts.
const PRODUCED_BY: Record<OrdinanceFlowStep, NullableFixtureField[]> = {
  intro: [],
  clarify: ['clarifyAnswers'],
  authority: ['authority'],
  current_law: ['existingLaw'],
  comparables: ['comparables'],
  draft: ['draftTitle', 'draftBody', 'draftSources', 'qualityReport'],
  review: [],
}

const STEP_ORDER: OrdinanceFlowStep[] = [
  'intro',
  'clarify',
  'authority',
  'current_law',
  'comparables',
  'draft',
  'review',
]

export const deriveStepEntry = (
  record: OrdinanceFixture,
  step: OrdinanceFlowStep,
): OrdinanceFixture => {
  const from = STEP_ORDER.indexOf(step)
  const stripped: Partial<OrdinanceFixture> = {}
  for (const later of STEP_ORDER.slice(from)) {
    for (const field of PRODUCED_BY[later]) {
      stripped[field] = null
    }
  }
  return { ...record, ...stripped }
}
