import { describe, expect, it } from 'vitest'
import type { CampaignTrackerTask } from 'gpApi/api-endpoints'
import { isTrackerGenerating } from './useTrackerTasks'

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
