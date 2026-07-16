import { describe, expect, it, vi } from 'vitest'
import { LlmService } from '@/llm/services/llm.service'
import { Ordinance } from '../../generated/prisma'
import {
  OrdinanceQualityReportService,
  qualityReportInputHash,
} from './ordinanceQualityReport.service'

const record = (overrides: Partial<Ordinance> = {}): Ordinance =>
  ({
    id: 'ord-1',
    draftTitle: 'Draft amendment',
    draftBody: 'Section 1. Delete footage after 30 days.',
    goalText: 'Add camera guardrails',
    authority: null,
    existingLaw: null,
    comparables: null,
    clarifyAnswers: null,
    ...overrides,
  }) as unknown as Ordinance

const build = (jsonCompletion: ReturnType<typeof vi.fn>) =>
  new OrdinanceQualityReportService({
    jsonCompletion,
  } as unknown as LlmService)

const fullResponse = {
  object: {
    checks: [
      { id: 'authority', status: 'pass', note: 'Council has authority.' },
      {
        id: 'legal_conflict',
        status: 'flag',
        note: 'Conflicts with Chapter 12.',
        source: { id: 's1', title: 'Municipal Code 12.20' },
      },
      { id: 'precedent_grounding', status: 'pass', note: 'Well grounded.' },
      { id: 'completeness', status: 'attention', note: 'Add effective date.' },
      { id: 'clarity', status: 'pass', note: 'Clear.' },
      { id: 'voice', status: 'pass', note: 'Good voice.' },
    ],
  },
  tokens: 10,
  model: 'claude-sonnet-4-6',
}

describe('OrdinanceQualityReportService', () => {
  it('assembles the six fixed checks in order with fixed labels', async () => {
    const report = await build(
      vi.fn().mockResolvedValue(fullResponse),
    ).generate(record(), 7)

    expect(report.checks.map((c) => c.id)).toEqual([
      'authority',
      'legal_conflict',
      'precedent_grounding',
      'completeness',
      'clarity',
      'voice',
    ])
    expect(report.checks.map((c) => c.label)).toEqual([
      'Authority',
      'Legal conflict',
      'Precedent grounding',
      'Completeness',
      'Clarity',
      'Voice',
    ])
  })

  it('computes the tally from the check statuses', async () => {
    const report = await build(
      vi.fn().mockResolvedValue(fullResponse),
    ).generate(record(), 7)

    expect(report.tally).toEqual({ pass: 4, flag: 1, attention: 1 })
  })

  it('stamps a fresh report with the current body hash', async () => {
    const draft = record()

    const report = await build(
      vi.fn().mockResolvedValue(fullResponse),
    ).generate(draft, 7)

    expect(report.stale).toBe(false)
    expect(report.ranAgainstBodyHash).toBe(qualityReportInputHash(draft))
  })

  it('coerces the userId to the string the LLM options expect', async () => {
    const jsonCompletion = vi.fn().mockResolvedValue(fullResponse)

    await build(jsonCompletion).generate(record(), 7)

    expect(jsonCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ userId: '7' }),
    )
  })

  it('fills a fallback for any check the model omits', async () => {
    const jsonCompletion = vi.fn().mockResolvedValue({
      object: { checks: [{ id: 'authority', status: 'pass', note: 'ok' }] },
      tokens: 10,
      model: 'claude-sonnet-4-6',
    })

    const report = await build(jsonCompletion).generate(record(), 7)

    expect(report.checks).toHaveLength(6)
    expect(report.checks.find((c) => c.id === 'voice')?.status).toBe(
      'attention',
    )
    expect(report.tally).toEqual({ pass: 1, flag: 0, attention: 5 })
  })
})
