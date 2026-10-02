import { describe, expect, it } from 'vitest'
import { SOCIAL_TONE_VALUES, type SocialTone } from '@goodparty_org/contracts'
import { grammarizeOfficeName } from 'app/polls/onboarding/utils/grammarizeOfficeName'
import {
  composeScript,
  identificationIntro,
  OPT_OUT_FOOTER,
  SERVE_SMS_IDENTIFICATION_FALLBACK,
  serveIdentificationIntro,
  provisionalCommitteeName,
  upgradeScriptFooter,
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

// A build-mode draft is composed with no committee, and resume carries the
// saved script verbatim -- the footer upgrade is the one edit allowed, so
// it is pinned tight: insert exactly the missing line, touch nothing else.
describe('upgradeScriptFooter', () => {
  const draftScript = composeScript('this is Jane, candidate for Mayor.', null)

  it('inserts the paid-for-by line above the opt-out footer', () => {
    expect(upgradeScriptFooter(draftScript, 'Jane for Mayor')).toBe(
      composeScript('this is Jane, candidate for Mayor.', 'Jane for Mayor'),
    )
  })

  it('returns the script unchanged with no committee', () => {
    expect(upgradeScriptFooter(draftScript, null)).toBe(draftScript)
  })

  it('never doubles an existing paid-for-by line', () => {
    const verified = composeScript('body', 'Jane for Mayor')
    expect(upgradeScriptFooter(verified, 'Jane for Mayor')).toBe(verified)
  })

  // The footer is locked and system-written, so a footer naming another
  // committee is one the system wrote earlier (a provisional name, or one
  // computed before the campaign finished loading): it is brought current.
  it('rewrites a footer naming an earlier committee', () => {
    const earlier = composeScript('body', 'Jane Doe')
    expect(upgradeScriptFooter(earlier, 'Friends of Jane')).toBe(
      composeScript('body', 'Friends of Jane'),
    )
  })

  // The delegate-caught case: the guard must be structural, because a body
  // can legitimately say "paid for by" without being the system footer.
  it('still upgrades when the body itself says "paid for by"', () => {
    const script = composeScript(
      'this is Jane, candidate for Mayor. This run is paid for by ' +
        'neighbors like you.',
      null,
    )
    expect(upgradeScriptFooter(script, 'Jane for Mayor')).toBe(
      composeScript(
        'this is Jane, candidate for Mayor. This run is paid for by ' +
          'neighbors like you.',
        'Jane for Mayor',
      ),
    )
  })

  it('swaps a provisional committee for the real one', () => {
    const provisional = composeScript(
      'this is Jane, candidate for Mayor.',
      'Jane Doe for Mayor',
    )
    expect(upgradeScriptFooter(provisional, 'Friends of Jane')).toBe(
      composeScript('this is Jane, candidate for Mayor.', 'Friends of Jane'),
    )
  })

  it('leaves a script that does not end with the system footer alone', () => {
    const edited = `${draftScript} PS vote early`
    expect(upgradeScriptFooter(edited, 'Jane for Mayor')).toBe(edited)
    expect(edited.includes(OPT_OUT_FOOTER)).toBe(true)
  })
})

describe('provisionalCommitteeName', () => {
  it('names the candidate and the office sought', () => {
    expect(provisionalCommitteeName('Sarah Chen', 'City Council')).toBe(
      'Sarah Chen for City Council',
    )
  })

  it('falls back to the name alone, and to nothing without one', () => {
    expect(provisionalCommitteeName('Sarah Chen', '')).toBe('Sarah Chen')
    expect(provisionalCommitteeName('  ', 'City Council')).toBeNull()
  })
})
