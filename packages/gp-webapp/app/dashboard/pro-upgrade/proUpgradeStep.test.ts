import { describe, it, expect } from 'vitest'
import {
  deriveProUpgradeStep,
  PRO_UPGRADE_STEP,
  PRO_UPGRADE_STEP_ORDER,
} from './proUpgradeStep'

describe('deriveProUpgradeStep', () => {
  // Design: the wizard always opens on its overview; the steps prefill from
  // what is saved, so nothing derives a later step from progress.
  it('lands a candidate who is not Pro on guidance', () => {
    expect(deriveProUpgradeStep({ isPro: false })).toBe(
      PRO_UPGRADE_STEP.GUIDANCE,
    )
  })

  it('routes an already-Pro candidate to the post-payment success surface', () => {
    expect(deriveProUpgradeStep({ isPro: true })).toBe(PRO_UPGRADE_STEP.SUCCESS)
  })
})

describe('PRO_UPGRADE_STEP_ORDER', () => {
  it('opens on guidance and collects filing details before payment', () => {
    expect(PRO_UPGRADE_STEP_ORDER).toEqual([
      PRO_UPGRADE_STEP.GUIDANCE,
      PRO_UPGRADE_STEP.STATUS,
      PRO_UPGRADE_STEP.EIN,
      PRO_UPGRADE_STEP.FILING_DETAILS,
      PRO_UPGRADE_STEP.PAYMENT,
      PRO_UPGRADE_STEP.SUCCESS,
    ])
  })
})
