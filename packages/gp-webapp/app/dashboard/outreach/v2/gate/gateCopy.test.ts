import { describe, it, expect } from 'vitest'
import { buildPlanPitch } from 'app/dashboard/shared/plan/planPitch'
import {
  EXPLAINER_COPY,
  PRO_COPY,
  planInterstitialCopy,
  withPlanPriceBullet,
} from './gateCopy'

describe('gateCopy plan copy', () => {
  it('replaces only the price bullet and never prints a legacy price', () => {
    const copy = withPlanPriceBullet(PRO_COPY.sms, buildPlanPitch(true, false))

    expect(copy.bullets[0]).toBe(
      '$299 for your campaign, with $175 in outreach credit',
    )
    expect(copy.bullets.slice(1)).toEqual(PRO_COPY.sms.bullets.slice(1))
    expect(copy.bullets.join(' ')).not.toMatch(/\$10\b|\/mo|free texts/)
  })

  it('names Team in the interstitial and explainer when recommended', () => {
    const pitch = buildPlanPitch(true, true)

    expect(planInterstitialCopy(pitch).cta).toBe('Join Team')
    expect(EXPLAINER_COPY.titleFree('door', pitch.name)).toBe(
      'Join Team to start knocking',
    )
  })

  it('keeps the Pro explainer title by default', () => {
    expect(EXPLAINER_COPY.titleFree('sms')).toBe(
      'Join Pro to send this campaign',
    )
  })
})
