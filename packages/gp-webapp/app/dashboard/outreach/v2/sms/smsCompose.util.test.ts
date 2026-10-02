import { describe, expect, it } from 'vitest'
import { SOCIAL_TONE_VALUES, type SocialTone } from '@goodparty_org/contracts'
import { grammarizeOfficeName } from 'app/polls/onboarding/utils/grammarizeOfficeName'
import {
  composeScript,
  ensureSmsIdentification,
  identificationIntro,
  openWithSmsIdentification,
  OPT_OUT_FOOTER,
  SERVE_SMS_IDENTIFICATION_FALLBACK,
  serveIdentificationIntro,
  provisionalCommitteeName,
  restoreSmsSystemRegions,
  unfilledBrackets,
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
  // Drafts saved while the footer was two lines are brought onto one.
  it('rewrites a two-line footer onto one line', () => {
    const twoLine =
      'Hello {first_name}, body\n\nPaid for by Jane Doe.\nReply STOP to opt out.'
    expect(upgradeScriptFooter(twoLine, 'Friends of Jane')).toBe(
      composeScript('body', 'Friends of Jane'),
    )
  })

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
  it('names the candidate alone, with no office', () => {
    expect(provisionalCommitteeName(' Sarah Chen ')).toBe('Sarah Chen')
  })

  it('is nothing without a name', () => {
    expect(provisionalCommitteeName('  ')).toBeNull()
  })
})

describe('ensureSmsIdentification', () => {
  const serveIntro = 'this is Bryan, your Asheville City Council Member.'
  const serve = {
    intro: serveIntro,
    firstName: 'Bryan',
    candidateNames: ['Bryan Levine'],
  }

  it('repairs the body that reached the P2P queue with two introductions', () => {
    // Composed, this read "Hello Sam, this is Bryan, your Asheville City
    // Council Member. Hi, this is [Your Name] from the City of Asheville. ..."
    const body =
      "this is Bryan, your Asheville City Council Member. Hi, this is [Your Name] from the City of Asheville. We're working on the budget."
    expect(ensureSmsIdentification(body, serve)).toBe(
      `${serveIntro} We're working on the budget.`,
    )
  })

  it('replaces an opener that names the council instead of the person', () => {
    expect(
      ensureSmsIdentification(
        'Hi, this is the Asheville City Council. We want your input on parks.',
        serve,
      ),
    ).toBe(`${serveIntro} We want your input on parks.`)
  })

  it('replaces a placeholder opener and its "from the City" phrase', () => {
    expect(
      ensureSmsIdentification(
        'Hi, this is [Your Name] from the City of Asheville. Budget hearing Tuesday.',
        serve,
      ),
    ).toBe(`${serveIntro} Budget hearing Tuesday.`)
  })

  it('prepends the intro to a body with no introduction, dropping its own greeting', () => {
    expect(
      ensureSmsIdentification('Hi! Early voting starts Monday.', {
        intro: identificationIntro('warm', 'Jane', 'City Council'),
        firstName: 'Jane',
        candidateNames: ['Jane Doe'],
      }),
    ).toBe(
      'this is Jane, candidate for City Council. Early voting starts Monday.',
    )
  })

  it('keeps a sentence that only looks like an opener', () => {
    expect(
      ensureSmsIdentification(
        'This is the last week to vote in our city.',
        serve,
      ),
    ).toBe(`${serveIntro} This is the last week to vote in our city.`)
  })

  it('fills a sender placeholder in a body that already names the sender', () => {
    expect(
      ensureSmsIdentification(
        `${serveIntro} Reply to reach me. [your name]`,
        serve,
      ),
    ).toBe(`${serveIntro} Reply to reach me. Bryan`)
  })

  it('reads a bare [Name] as the sender only beside a self-introduction', () => {
    expect(
      ensureSmsIdentification("It's [Name] here. Town hall Thursday.", serve),
    ).toBe(`${serveIntro} Town hall Thursday.`)
    expect(
      ensureSmsIdentification(
        `${serveIntro} Thanks, [Name], for writing in.`,
        serve,
      ),
    ).toBe(`${serveIntro} Thanks, [Name], for writing in.`)
  })

  it('leaves a body that already passes untouched', () => {
    const body = 'Hey, Bryan here. Town hall Thursday at [time].'
    expect(ensureSmsIdentification(body, serve)).toBe(body)
  })

  it('leaves everything alone with no name to check against', () => {
    const body = 'Hi, this is [Your Name].'
    expect(
      ensureSmsIdentification(body, { ...serve, candidateNames: [] }),
    ).toBe(body)
  })

  it('never stacks a second intro on a repeat pass', () => {
    const once = ensureSmsIdentification('Early voting starts Monday.', serve)
    expect(ensureSmsIdentification(once, serve)).toBe(once)
  })
})

describe('unfilledBrackets', () => {
  it('lists each bracket once', () => {
    expect(
      unfilledBrackets('📅 [Date] | 🕐 [Time] at [Date] | {first_name}'),
    ).toEqual(['[Date]', '[Time]'])
  })
})

describe('openWithSmsIdentification', () => {
  const win = {
    intro: identificationIntro('direct', 'Jane', 'City Council'),
    firstName: 'Jane',
    candidateNames: ['Jane Doe'],
  }

  it("replaces the model's own introduction instead of stacking under it", () => {
    expect(
      openWithSmsIdentification(
        'Hi, this is Jane, running for City Council. Vote early.',
        win,
      ),
    ).toBe('Jane here, candidate for City Council. Vote early.')
  })

  it('opens a plain body on the intro', () => {
    expect(openWithSmsIdentification('Vote early.', win)).toBe(
      'Jane here, candidate for City Council. Vote early.',
    )
  })
})

describe('restoreSmsSystemRegions', () => {
  const regions = {
    greeting: 'Hello {first_name},',
    footer: 'Paid for by Friends of Sarah Chen. Reply STOP to opt out.',
    token: '{first_name}',
  }

  it('returns a reply that kept its parts unchanged', () => {
    const reply = `Hello {first_name}, vote Tuesday.\n\n${regions.footer}`
    expect(restoreSmsSystemRegions(reply, regions)).toBe(reply)
  })

  it('keeps a footer the model closed on after a single line break', () => {
    expect(
      restoreSmsSystemRegions(
        `Hello {first_name}, vote Tuesday.\n${regions.footer}`,
        regions,
      ),
    ).toBe(`Hello {first_name}, vote Tuesday.\n\n${regions.footer}`)
  })

  it('composes the greeting and footer around a body-only reply', () => {
    expect(restoreSmsSystemRegions('Vote Tuesday.', regions)).toBe(
      `Hello {first_name}, Vote Tuesday.\n\n${regions.footer}`,
    )
  })

  // The greeting's words are not locked, only the token is.
  it('keeps a reworded greeting that kept the token, without a second one', () => {
    const reply = `Hi {first_name}! Vote Tuesday.\n\n${regions.footer}`
    expect(restoreSmsSystemRegions(reply, regions)).toBe(reply)
  })

  it('never eats a body sentence that says reply STOP', () => {
    expect(
      restoreSmsSystemRegions(
        'Hello {first_name}, questions? Reply STOP is not how to reach me.',
        regions,
      ),
    ).toBe(
      'Hello {first_name}, questions? Reply STOP is not how to reach me.' +
        `\n\n${regions.footer}`,
    )
  })

  it('replaces a closing paragraph that is a rewritten footer', () => {
    expect(
      restoreSmsSystemRegions(
        'Hello {first_name}, vote Tuesday.\n\nReply STOP to unsubscribe.',
        regions,
      ),
    ).toBe(`Hello {first_name}, vote Tuesday.\n\n${regions.footer}`)
  })

  // A last paragraph that only mentions the footer's words is the
  // candidate's, and stays.
  it('keeps a closing paragraph that only mentions paid for by', () => {
    expect(
      restoreSmsSystemRegions(
        'Hello {first_name}, vote Tuesday.\n\nOur event was paid for by the community.',
        regions,
      ),
    ).toBe(
      'Hello {first_name}, vote Tuesday.\n\nOur event was paid for by the community.' +
        `\n\n${regions.footer}`,
    )
  })
})
