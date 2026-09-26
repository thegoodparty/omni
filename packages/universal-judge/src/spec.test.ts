import { describe, expect, it } from 'vitest'
import {
  applyCaps,
  DEFAULT_SAMPLES,
  estimateCost,
  isTriggered,
  MAX_ESTIMATED_COST_USD,
  MAX_SAMPLES_PER_AGENT,
  parseDeterministic,
  scanAliases,
} from './spec.js'

describe('isTriggered', () => {
  it('fires on the phrase anywhere in the comment', () => {
    expect(isTriggered('run the universal judge on briefings')).toBe(true)
    expect(isTriggered('Universal  Judge please')).toBe(true)
  })

  it('ignores unrelated comments', () => {
    expect(isTriggered('lgtm')).toBe(false)
    expect(isTriggered('delegate review')).toBe(false)
  })
})

describe('scanAliases', () => {
  it('reads the example command from the ticket', () => {
    const found = scanAliases(
      'run the universal judge on meeting briefings and ordinances and community issues',
    )
    expect(found).toContain('meeting_briefing')
    expect(found).toContain('ordinance_draft')
    expect(found).toContain('top_community_issues')
  })

  it('prefers the longest matching alias', () => {
    // "top community issues" must not also register the bare "issues" alias, and
    // must not be mistaken for a different agent.
    expect(scanAliases('check top community issues')).toEqual([
      'top_community_issues',
    ])
  })

  it('does not double-count one agent named two ways', () => {
    expect(scanAliases('the briefing / meeting briefing agent')).toEqual([
      'meeting_briefing',
    ])
  })

  it('returns nothing when no agent is named', () => {
    expect(scanAliases('run the universal judge')).toEqual([])
  })
})

describe('parseDeterministic', () => {
  it('returns undefined when it recognises no agent, so the caller can fall back', () => {
    expect(
      parseDeterministic('run the universal judge on the thing'),
    ).toBeUndefined()
  })

  it('expands "all" to every agent', () => {
    const spec = parseDeterministic('run the universal judge on all agents')
    expect(spec!.agents.length).toBeGreaterThan(1)
  })

  it('reads an explicit sample count', () => {
    const spec = parseDeterministic(
      'universal judge on community issues with 7 samples',
    )
    expect(spec!.samplesPerAgent).toBe(7)
  })

  it('defaults the sample count when none is given', () => {
    const spec = parseDeterministic('universal judge on community issues')
    expect(spec!.samplesPerAgent).toBe(DEFAULT_SAMPLES)
  })

  it('detects an explicit baseline refresh', () => {
    expect(
      parseDeterministic('universal judge on issues, refresh baseline')!
        .refreshBaseline,
    ).toBe(true)
    expect(
      parseDeterministic('universal judge on issues')!.refreshBaseline,
    ).toBe(false)
  })
})

describe('applyCaps', () => {
  it('clamps an absurd sample count and says so', () => {
    const spec = applyCaps({
      agents: ['top_community_issues'],
      samplesPerAgent: 500,
      refreshBaseline: false,
      notes: [],
    })
    expect(spec.samplesPerAgent).toBeLessThanOrEqual(MAX_SAMPLES_PER_AGENT)
    expect(spec.notes.join(' ')).toMatch(/capped/i)
  })

  it('trims samples to stay inside the spend ceiling for an expensive agent', () => {
    const spec = applyCaps({
      agents: ['meeting_briefing'],
      samplesPerAgent: MAX_SAMPLES_PER_AGENT,
      refreshBaseline: false,
      notes: [],
    })
    expect(estimateCost(spec)).toBeLessThanOrEqual(MAX_ESTIMATED_COST_USD)
    expect(spec.notes.join(' ')).toMatch(/ceiling/i)
  })

  it('never trims below one case', () => {
    const spec = applyCaps({
      agents: [
        'meeting_briefing',
        'top_community_issues',
        'find_existing_ordinances',
      ],
      samplesPerAgent: 10,
      refreshBaseline: false,
      notes: [],
    })
    expect(spec.samplesPerAgent).toBeGreaterThanOrEqual(1)
  })

  it('leaves a modest request untouched', () => {
    const spec = applyCaps({
      agents: ['find_existing_ordinances'],
      samplesPerAgent: 3,
      refreshBaseline: false,
      notes: [],
    })
    expect(spec.samplesPerAgent).toBe(3)
    expect(spec.notes).toEqual([])
  })
})

describe('estimateCost', () => {
  it('prices both sides of every case', () => {
    const cost = estimateCost({
      agents: ['find_existing_ordinances'],
      samplesPerAgent: 2,
      refreshBaseline: false,
      notes: [],
    })
    // 1.5/run, two variants, two cases.
    expect(cost).toBeCloseTo(6, 10)
  })
})
