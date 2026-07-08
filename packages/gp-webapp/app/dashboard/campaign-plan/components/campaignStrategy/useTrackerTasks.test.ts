import { describe, expect, it } from 'vitest'
import type { CampaignTrackerTask } from 'gpApi/api-endpoints'
import { isTrackerGenerating, isVoterContactFlowType } from './useTrackerTasks'

const row = (isDefaultTask: boolean): CampaignTrackerTask => ({
  id: 'x',
  title: 'T',
  description: 'D',
  cta: null,
  link: null,
  flowType: null,
  week: 0,
  date: '2026-02-01',
  completed: false,
  phase: 'preLaunch',
  proRequired: null,
  isDefaultTask,
})

describe('isTrackerGenerating', () => {
  it('is false when there are no rows yet (nothing to wait on)', () => {
    expect(isTrackerGenerating([])).toBe(false)
  })

  it('is true when only static rows exist (dynamic still generating)', () => {
    expect(isTrackerGenerating([row(true), row(true)])).toBe(true)
  })

  it('is false once any dynamic row has landed', () => {
    expect(isTrackerGenerating([row(true), row(false)])).toBe(false)
  })
})

describe('isVoterContactFlowType', () => {
  it('is true for community events and the outreach channels', () => {
    for (const flow of [
      'events',
      'doorKnocking',
      'phoneBanking',
      'text',
      'robocall',
      'socialMedia',
    ]) {
      expect(isVoterContactFlowType(flow)).toBe(true)
    }
  })

  it('is false for non-outreach flow types and null', () => {
    expect(isVoterContactFlowType('awareness')).toBe(false)
    expect(isVoterContactFlowType('general')).toBe(false)
    expect(isVoterContactFlowType(null)).toBe(false)
  })
})
