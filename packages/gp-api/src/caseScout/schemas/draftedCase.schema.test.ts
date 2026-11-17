import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as judgeCases from '@/chats/evals/judge/cases'
import {
  ANSWERED_VALUES,
  CONFIDENCE_VALUES,
  FAILURES,
  KNOWN_PATTERNS,
  RATING_VALUES,
  SCORING_PROMPT,
  SEVERITY_VALUES,
  USE_CASES,
  YES_NO_VALUES,
} from '../caseScout.prompts'
import { ScoreResponseSchema } from './caseScoutModel.schema'
import {
  DraftedCaseSchema,
  MAX_CASE_TURNS,
  MAX_CONDITION_CHARS,
  MAX_HANDLED_WHEN_CHARS,
} from './draftedCase.schema'

// The mirror exists only because the production build leaves out
// src/chats/evals; these pin it to the real ChatCaseSchema.
const base = {
  caseId: 'a-case',
  condition: 'A condition.',
  handledWhen: 'A handled-when.',
  source: 'production',
  split: 'tune',
  question: 'A question?',
}

describe('DraftedCaseSchema', () => {
  it('shares the case bounds of cases.ts', () => {
    expect(MAX_CASE_TURNS).toBe(judgeCases.MAX_CASE_TURNS)
    expect(MAX_CONDITION_CHARS).toBe(judgeCases.MAX_CONDITION_CHARS)
    expect(MAX_HANDLED_WHEN_CHARS).toBe(judgeCases.MAX_HANDLED_WHEN_CHARS)
  })

  it.each([
    ['a valid question case', base],
    ['a valid turns case', { ...base, question: undefined, turns: ['a', 'b'] }],
    ['an 80-character caseId', { ...base, caseId: 'x'.repeat(80) }],
    ['an 81-character caseId', { ...base, caseId: 'x'.repeat(81) }],
    ['a caseId with a space', { ...base, caseId: 'a case' }],
    ['both question and turns', { ...base, turns: ['a'] }],
    ['neither question nor turns', { ...base, question: undefined }],
    [
      'eleven turns',
      { ...base, question: undefined, turns: Array(11).fill('t') },
    ],
    ['an empty turn', { ...base, question: undefined, turns: [''] }],
    ['a blank condition', { ...base, condition: '   ' }],
    [
      'a padded maximal condition',
      { ...base, condition: ` ${'x'.repeat(2000)} ` },
    ],
    ['a long condition', { ...base, condition: 'x'.repeat(2001) }],
    ['a long handledWhen', { ...base, handledWhen: 'x'.repeat(601) }],
    ['a stray field', { ...base, priorTranscipt: [] }],
  ])('agrees with ChatCaseSchema on %s', (_label, candidate) => {
    expect(DraftedCaseSchema.safeParse(candidate).success).toBe(
      judgeCases.ChatCaseSchema.safeParse(candidate).success,
    )
  })
})

describe('ScoreResponseSchema', () => {
  it('offers the model exactly the values the prompt lists', () => {
    const json = JSON.stringify(z.toJSONSchema(ScoreResponseSchema))
    for (const values of [
      USE_CASES,
      FAILURES,
      KNOWN_PATTERNS,
      ANSWERED_VALUES,
      RATING_VALUES,
      CONFIDENCE_VALUES,
      YES_NO_VALUES,
      SEVERITY_VALUES,
    ]) {
      expect(json).toContain(JSON.stringify(values))
    }
    expect(SCORING_PROMPT).toContain(KNOWN_PATTERNS.join(' | '))
    expect(SCORING_PROMPT).not.toContain('are NOT stored in this transcript')
  })
})
