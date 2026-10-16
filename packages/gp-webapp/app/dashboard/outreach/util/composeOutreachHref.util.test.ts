import { describe, expect, it } from 'vitest'
import {
  composeOutreachHref,
  flowSourceFromCompose,
  recommendedVariantForTask,
} from './composeOutreachHref.util'

describe('recommendedVariantForTask', () => {
  it('opens the early-vote text and its robocall swap on the early-vote list', () => {
    expect(recommendedVariantForTask('Early Voting Text')).toBe(
      'earlyVoteAffinity',
    )
    expect(recommendedVariantForTask('Early Voting Robocall')).toBe(
      'earlyVoteAffinity',
    )
  })

  it('names no list for any other task', () => {
    expect(recommendedVariantForTask('Persuasion Robocall')).toBeNull()
    expect(recommendedVariantForTask(null)).toBeNull()
  })
})

describe('composeOutreachHref', () => {
  it('carries a recommended list when one is given', () => {
    const href = composeOutreachHref(
      'text',
      'campaign_tracker',
      '2026-10-20T00:00:00Z',
      undefined,
      'earlyVoteAffinity',
    )
    const params = new URL(href, 'https://x').searchParams
    expect(params.get('recommended')).toBe('earlyVoteAffinity')
    expect(params.get('compose')).toBe('text')
    expect(params.get('due')).toBe('2026-10-20')
  })

  it('leaves the param off otherwise', () => {
    const href = composeOutreachHref('robocall', 'campaign_manager')
    expect(new URL(href, 'https://x').searchParams.has('recommended')).toBe(
      false,
    )
  })
})

describe('flowSourceFromCompose', () => {
  it('reads the tracker as the campaign plan', () => {
    expect(flowSourceFromCompose('campaign_tracker')).toBe('campaign_plan')
  })

  it('passes the other compose sources through', () => {
    expect(flowSourceFromCompose('campaign_manager')).toBe('campaign_manager')
    expect(flowSourceFromCompose('voter_data')).toBe('voter_data')
  })

  it('reads a link with no source as a deep link', () => {
    expect(flowSourceFromCompose(undefined)).toBe('deep_link')
  })
})
