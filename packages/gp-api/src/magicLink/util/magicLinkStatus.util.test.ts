import { describe, expect, it } from 'vitest'
import { MagicLinkKind } from '../../generated/prisma'
import {
  buildMagicLinkContactProperties,
  computeMagicLinkStatus,
} from './magicLinkStatus.util'

const NOW = new Date('2026-06-26T12:00:00.000Z')
const FUTURE = new Date('2026-07-03T12:00:00.000Z')
const PAST = new Date('2026-06-19T12:00:00.000Z')

describe('computeMagicLinkStatus', () => {
  it('returns "sent" for an unredeemed link that has not expired', () => {
    expect(
      computeMagicLinkStatus(
        { expiresAt: FUTURE, redeemedAt: null, onboardingCompletedAt: null },
        NOW,
      ),
    ).toBe('sent')
  })

  it('returns "expired" once the expiry has passed and nothing happened', () => {
    expect(
      computeMagicLinkStatus(
        { expiresAt: PAST, redeemedAt: null, onboardingCompletedAt: null },
        NOW,
      ),
    ).toBe('expired')
  })

  it('returns "redeemed" once redeemed, even after expiry', () => {
    expect(
      computeMagicLinkStatus(
        { expiresAt: PAST, redeemedAt: PAST, onboardingCompletedAt: null },
        NOW,
      ),
    ).toBe('redeemed')
  })

  it('returns "onboarding_completed" once completed, regardless of expiry', () => {
    expect(
      computeMagicLinkStatus(
        { expiresAt: PAST, redeemedAt: PAST, onboardingCompletedAt: PAST },
        NOW,
      ),
    ).toBe('onboarding_completed')
  })
})

describe('buildMagicLinkContactProperties', () => {
  const base = {
    kind: MagicLinkKind.SERVE,
    url: 'https://dev.goodparty.org/serve/welcome?__clerk_ticket=tok',
    sentAt: NOW,
    expiresAt: FUTURE,
    redeemedAt: null,
    onboardingCompletedAt: null,
  }

  it('writes the EO property set with ISO timestamps and derived status', () => {
    expect(buildMagicLinkContactProperties(base, NOW)).toEqual({
      eo_magic_link_status: 'sent',
      eo_magic_link_sent_at: NOW.toISOString(),
      eo_magic_link_expires_at: FUTURE.toISOString(),
      eo_magic_link_redeemed_at: '',
      eo_onboarding_completed_at: '',
    })
  })

  it('never mirrors the raw redemption URL to HubSpot', () => {
    const props = buildMagicLinkContactProperties(base, NOW)
    expect(props).not.toHaveProperty('eo_magic_link_url')
    expect(props).not.toHaveProperty('win_magic_link_url')
    expect(Object.values(props)).not.toContain(base.url)
  })

  it('clears redeemed/completed slots with empty strings when unset', () => {
    const props = buildMagicLinkContactProperties(base, NOW)
    expect(props.eo_magic_link_redeemed_at).toBe('')
    expect(props.eo_onboarding_completed_at).toBe('')
  })

  it('reflects redeemed + completed timestamps and status', () => {
    const props = buildMagicLinkContactProperties(
      { ...base, redeemedAt: NOW, onboardingCompletedAt: FUTURE },
      NOW,
    )
    expect(props.eo_magic_link_status).toBe('onboarding_completed')
    expect(props.eo_magic_link_redeemed_at).toBe(NOW.toISOString())
    expect(props.eo_onboarding_completed_at).toBe(FUTURE.toISOString())
  })

  it('uses the win property set for WIN links', () => {
    const props = buildMagicLinkContactProperties(
      { ...base, kind: MagicLinkKind.WIN },
      NOW,
    )
    expect(props).toHaveProperty('win_magic_link_status', 'sent')
    expect(props).not.toHaveProperty('eo_magic_link_status')
  })
})
