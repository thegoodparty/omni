import { describe, it, expect } from 'vitest'
import { buildPlanPitch } from 'app/dashboard/shared/plan/planPitch'
import {
  EXPLAINER_COPY,
  PRO_COPY,
  PRO_COPY_SMS_CLOSED,
  planInterstitialCopy,
  planListGateCta,
  planReviewGateCta,
  withPlanPriceBullet,
} from './gateCopy'

describe('gateCopy plan copy', () => {
  it('swaps the price bullet, keeps the channel bullets and adds the credit', () => {
    const copy = withPlanPriceBullet(
      PRO_COPY.sms,
      buildPlanPitch(true, true, false),
    )

    expect(copy.bullets).toEqual([
      'Pay $299 once for your plan, good for your whole race',
      'Your message, delivered to every voter you picked',
      'Scheduled for the day and time you choose',
      '$175 outreach credit to get started',
    ])
    expect(copy.bullets.join(' ')).not.toMatch(/\$10\b|\/mo|free texts/)
  })

  it.each(Object.entries(PRO_COPY))(
    'gives the %s pitch four bullets with its own two in the middle',
    (_channel, base) => {
      const copy = withPlanPriceBullet(base, buildPlanPitch(true, true, false))

      expect(copy.bullets).toHaveLength(4)
      expect(copy.bullets.slice(1, 3)).toEqual(base.bullets.slice(1))
    },
  )

  it('gives the closed-texting pitch the same four rows', () => {
    const copy = withPlanPriceBullet(
      PRO_COPY_SMS_CLOSED,
      buildPlanPitch(true, true, false),
    )

    expect(copy.bullets).toHaveLength(4)
    expect(copy.bullets[3]).toBe('$175 outreach credit to get started')
  })

  it('names Team in the interstitial and explainer when recommended', () => {
    const pitch = buildPlanPitch(true, true, true)

    expect(planInterstitialCopy(pitch, 'sms').cta).toBe(
      `Join Team for ${pitch.price}`,
    )
    expect(EXPLAINER_COPY.titleFree('door', pitch.name)).toBe(
      'Join Team to start knocking',
    )
  })

  it('prices the Pro join button and has no "Maybe later"', () => {
    const copy = planInterstitialCopy(buildPlanPitch(true, true, false), 'sms')

    expect(copy).toEqual({
      title: 'Join Pro to send this campaign',
      cta: 'Join Pro for $299',
      seeAllPlans: 'See all plans',
    })
  })

  it.each([
    ['door', 'Join Pro to start knocking'],
    ['phone-bank', 'Join Pro to call this list'],
    ['sms', 'Join Pro to send this campaign'],
    ['robocall', 'Join Pro to send this campaign'],
  ] as const)('titles the %s pitch for what Pro unlocks', (channel, title) => {
    expect(
      planInterstitialCopy(buildPlanPitch(true, true, false), channel).title,
    ).toBe(title)
  })

  it('names the free review button for what it opens', () => {
    expect(planReviewGateCta(buildPlanPitch(true, true, false))).toBe(
      'Join Pro to send',
    )
  })

  it(
    'names the list channels' + "'" + ' free button for what Pro unlocks',
    () => {
      const pitch = buildPlanPitch(true, true, false)
      expect(planListGateCta('door', pitch)).toBe('Join Pro to start knocking')
      expect(planListGateCta('phone-bank', pitch)).toBe(
        'Join Pro to call this list',
      )
    },
  )

  it('keeps the Pro explainer title by default', () => {
    expect(EXPLAINER_COPY.titleFree('sms')).toBe(
      'Join Pro to send this campaign',
    )
  })
})
