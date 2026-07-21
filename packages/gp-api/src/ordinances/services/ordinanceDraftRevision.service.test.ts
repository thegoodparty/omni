import { describe, expect, it, vi } from 'vitest'
import { type OrdinanceQualityCheck } from '@goodparty_org/contracts'
import { LlmService } from '@/llm/services/llm.service'
import { Ordinance } from '../../generated/prisma'
import {
  QUALITY_LOOP_LLM_RETRIES,
  QUALITY_LOOP_MODELS,
} from '../ordinances.constants'
import {
  OrdinanceDraftRevisionService,
  OrdinanceRevisionGuardError,
} from './ordinanceDraftRevision.service'

const record = (overrides: Partial<Ordinance> = {}): Ordinance =>
  ({
    id: 'ord-1',
    draftTitle: 'Camera retention amendment',
    draftBody:
      'Section 1. Footage shall be deleted after 30 days. ' +
      'Section 2. This ordinance takes effect immediately.',
    goalText: 'Add camera guardrails',
    authority: {
      status: 'pass',
      explanation: 'Home-rule power covers surveillance rules.',
      source: { id: 'auth-1', title: 'City Charter §3' },
    },
    existingLaw: {
      sourceUrl: 'https://example.gov/code/12',
      text: 'Chapter 12: cameras may record public areas.',
      fetchedAt: '2026-07-01T00:00:00.000Z',
    },
    comparables: [
      {
        city: 'Edgewater',
        state: 'CO',
        quote: 'Deleted after 14 days.',
        status: 'passed',
        source: { id: 'comp-1', title: 'Edgewater Ord. 2022-4' },
      },
    ],
    clarifyAnswers: null,
    draftSources: [{ id: 'ds-1', title: 'ACLU model policy' }],
    ...overrides,
  }) as unknown as Ordinance

const flaggedChecks: OrdinanceQualityCheck[] = [
  {
    id: 'legal_conflict',
    label: 'Legal conflict',
    status: 'flag',
    note: 'Section 1 conflicts with Chapter 12 retention rules.',
  },
]

const build = (jsonCompletion: ReturnType<typeof vi.fn>) =>
  new OrdinanceDraftRevisionService({
    jsonCompletion,
  } as unknown as LlmService)

const revisedBody =
  'Section 1. Footage shall be deleted after 30 days, except as Chapter 12 ' +
  'requires longer retention. Section 2. This ordinance takes effect ' +
  'immediately.'

const modelOutput = (overrides: object = {}) => ({
  object: {
    title: 'Camera retention amendment',
    body: revisedBody,
    revisions: [
      { checkId: 'legal_conflict', note: 'Aligned retention with Chapter 12.' },
    ],
    ...overrides,
  },
  tokens: 20,
  model: 'claude-sonnet-4-6',
})

describe('OrdinanceDraftRevisionService', () => {
  it('returns the revised draft and per-check notes', async () => {
    const revision = await build(
      vi.fn().mockResolvedValue(modelOutput()),
    ).revise(record(), flaggedChecks)

    expect(revision.title).toBe('Camera retention amendment')
    expect(revision.body).toBe(revisedBody)
    expect(revision.revisions).toEqual([
      { checkId: 'legal_conflict', note: 'Aligned retention with Chapter 12.' },
    ])
    expect(revision.sourcesToAdd).toEqual([])
    expect(revision.tokens).toBe(20)
  })

  it('threads the pinned loop models, retries, budget, and abort signal', async () => {
    const jsonCompletion = vi.fn().mockResolvedValue(modelOutput())
    const abortSignal = AbortSignal.timeout(60_000)

    await build(jsonCompletion).revise(record(), flaggedChecks, {
      abortSignal,
    })

    expect(jsonCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        models: QUALITY_LOOP_MODELS,
        retries: QUALITY_LOOP_LLM_RETRIES,
        maxTokens: 8192,
        abortSignal,
      }),
    )
  })

  it('prompts with the draft sections and the flagged checks', async () => {
    const jsonCompletion = vi.fn().mockResolvedValue(modelOutput())

    await build(jsonCompletion).revise(record(), flaggedChecks)

    const options = jsonCompletion.mock.calls[0]?.[0]
    const user = options?.messages.find(
      (m: { role: string }) => m.role === 'user',
    )
    expect(user.content).toContain('## Draft body')
    expect(user.content).toContain('Section 1. Footage shall be deleted')
    expect(user.content).toContain('## Flagged checks')
    expect(user.content).toContain('Legal conflict')
    expect(user.content).toContain(
      'Section 1 conflicts with Chapter 12 retention rules.',
    )
  })

  it('resolves sourceIdsToAdd against on-record sources and drops unknown ids', async () => {
    const jsonCompletion = vi.fn().mockResolvedValue(
      modelOutput({
        sourceIdsToAdd: ['comp-1', 'auth-1', 'ds-1', 'comp-1', 'made-up'],
      }),
    )

    const revision = await build(jsonCompletion).revise(record(), flaggedChecks)

    expect(revision.sourcesToAdd).toEqual([
      { id: 'comp-1', title: 'Edgewater Ord. 2022-4' },
      { id: 'auth-1', title: 'City Charter §3' },
      { id: 'ds-1', title: 'ACLU model policy' },
    ])
  })

  it('throws the guard error when the revised body shrinks below half', async () => {
    const jsonCompletion = vi
      .fn()
      .mockResolvedValue(modelOutput({ body: 'Gutted.' }))

    await expect(
      build(jsonCompletion).revise(record(), flaggedChecks),
    ).rejects.toBeInstanceOf(OrdinanceRevisionGuardError)
  })

  it('accepts a revised body at exactly half the previous length', async () => {
    const previous = record()
    const halfLength = Math.ceil((previous.draftBody ?? '').length / 2)
    const jsonCompletion = vi
      .fn()
      .mockResolvedValue(modelOutput({ body: 'x'.repeat(halfLength) }))

    const revision = await build(jsonCompletion).revise(previous, flaggedChecks)

    expect(revision.body).toBe('x'.repeat(halfLength))
  })
})
