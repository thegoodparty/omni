import { describe, expect, it } from 'vitest'
import { SOCIAL_TONE_VALUES, type SocialTone } from '@goodparty_org/contracts'
import { grammarizeOfficeName } from 'app/polls/onboarding/utils/grammarizeOfficeName'
import {
  identificationIntro,
  SERVE_SMS_IDENTIFICATION_FALLBACK,
  serveIdentificationIntro,
} from './smsCompose.util'

// The identification sentence is the one piece of Serve copy that could not
// be a reworded Win string: Win says the sender is running for an office,
// Serve says they hold one. Both halves are pinned here — the Serve variant
// because it is new, the Win variant because "Win is unchanged" is the
// load-bearing claim of the whole surface split.

describe('serveIdentificationIntro', () => {
  const cases: Record<SocialTone, string> = {
    warm: 'this is Jane, your City Council Member.',
    direct: 'Jane here, your City Council Member.',
    friendly: "it's Jane, your City Council Member.",
    // Converges with direct on purpose: "running for" is what set urgent
    // apart on Win, and an elected official is not running for anything.
    urgent: 'Jane here, your City Council Member.',
  }

  it.each(SOCIAL_TONE_VALUES)('states the office held (%s)', (tone) => {
    expect(serveIdentificationIntro(tone, 'Jane', 'City Council Member')).toBe(
      cases[tone],
    )
  })

  it.each(SOCIAL_TONE_VALUES)('never says "candidate for" (%s)', (tone) => {
    const line = serveIdentificationIntro(tone, 'Jane', 'City Council Member')
    expect(line).not.toMatch(/candidate for/)
    expect(line).not.toMatch(/running for/)
    expect(line).toContain('your City Council Member')
  })

  // The grammar is polls' function, reused rather than re-derived: the flow
  // hands this the already-grammarized name, and this is what that name
  // looks like coming out of it.
  it('reads correctly on a grammarized position name', () => {
    expect(grammarizeOfficeName('City Council - District 3')).toBe(
      'City Council Member',
    )
    expect(
      serveIdentificationIntro(
        'warm',
        'Jane',
        grammarizeOfficeName('City Council - District 3'),
      ),
    ).toBe('this is Jane, your City Council Member.')
  })

  it('degrades to a sentence when a part is missing', () => {
    expect(serveIdentificationIntro('warm', '', 'Mayor')).toBe(
      `this is ${SERVE_SMS_IDENTIFICATION_FALLBACK.name}, your Mayor.`,
    )
    expect(serveIdentificationIntro('warm', 'Jane', '')).toBe(
      `this is Jane, your ${SERVE_SMS_IDENTIFICATION_FALLBACK.office}.`,
    )
  })
})

describe('identificationIntro (Win, unchanged)', () => {
  const cases: Record<SocialTone, string> = {
    warm: 'this is Jane, candidate for City Council.',
    direct: 'Jane here, candidate for City Council.',
    friendly: "it's Jane, running for City Council.",
    urgent: 'Jane here, running for City Council.',
  }

  it.each(SOCIAL_TONE_VALUES)('still frames a candidacy (%s)', (tone) => {
    expect(identificationIntro(tone, 'Jane', 'City Council')).toBe(cases[tone])
  })
})
