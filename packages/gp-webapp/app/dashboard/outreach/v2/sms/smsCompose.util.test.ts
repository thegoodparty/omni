import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CIVIC_PANEL_JOIN_LINE,
  CIVIC_PANEL_JOIN_LINES,
  CIVIC_PANEL_LEAVE_LINE,
  deriveSmsProtectedParts,
  SOCIAL_TONE_VALUES,
  type SocialTone,
} from '@goodparty_org/contracts'
import { grammarizeOfficeName } from 'app/polls/onboarding/utils/grammarizeOfficeName'
import {
  addGreetingBack,
  addIdentificationBack,
  addOptOutBack,
  addPaidForByBack,
  composeScript,
  IMAGE_MAX_BYTES,
  profilePhotoFile,
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
  withCivicPanelJoin,
  withCivicPanelLeave,
  withCivicPanelLines,
  composeServeScript,
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

describe('identificationIntro (Win)', () => {
  const cases: Record<SocialTone, string> = {
    warm: 'this is Jane Doe, candidate for City Council.',
    direct: 'Jane Doe here, candidate for City Council.',
    friendly: "it's Jane Doe, running for City Council.",
    urgent: 'Jane Doe here, running for City Council.',
  }

  it.each(SOCIAL_TONE_VALUES)(
    'frames a candidacy under the full name (%s)',
    (tone) => {
      expect(identificationIntro(tone, 'Jane Doe', 'City Council')).toBe(
        cases[tone],
      )
    },
  )
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
    senderName: 'Bryan',
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
        intro: identificationIntro('warm', 'Jane Doe', 'City Council'),
        senderName: 'Jane Doe',
        candidateNames: ['Jane Doe'],
      }),
    ).toBe(
      'this is Jane Doe, candidate for City Council. Early voting starts Monday.',
    )
  })

  it("fills a Win sender placeholder with the candidate's full name", () => {
    expect(
      ensureSmsIdentification('Vote Tuesday. [Your Name]', {
        intro: identificationIntro('warm', 'Jane Doe', 'City Council'),
        senderName: 'Jane Doe',
        candidateNames: ['Jane Doe'],
      }),
    ).toBe('Vote Tuesday. Jane Doe')
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
    intro: identificationIntro('direct', 'Jane Doe', 'City Council'),
    senderName: 'Jane Doe',
    candidateNames: ['Jane Doe'],
  }

  // The model is told not to introduce the candidate, but when it does it
  // tends to use the first name; the full-name intro replaces it.
  it.each([
    'Hi, this is Jane, running for City Council. Vote early.',
    'Jane here, candidate for City Council. Vote early.',
    'this is Jane Doe, candidate for City Council. Vote early.',
    'Jane Doe here, running for City Council. Vote early.',
  ])("replaces the model's own introduction: %s", (body) => {
    expect(openWithSmsIdentification(body, win)).toBe(
      'Jane Doe here, candidate for City Council. Vote early.',
    )
  })

  it('opens a plain body on the intro', () => {
    expect(openWithSmsIdentification('Vote early.', win)).toBe(
      'Jane Doe here, candidate for City Council. Vote early.',
    )
  })

  it.each(SOCIAL_TONE_VALUES)(
    'never stacks a second full-name intro on a repeat pass (%s)',
    (tone) => {
      const context = {
        ...win,
        intro: identificationIntro(tone, 'Jane Doe', 'City Council'),
      }
      const once = openWithSmsIdentification('Vote early.', context)
      expect(openWithSmsIdentification(once, context)).toBe(once)
      expect(ensureSmsIdentification(once, context)).toBe(once)
    },
  )

  describe('with a name longer than two words', () => {
    const long = {
      intro: identificationIntro('direct', 'Mary Ann Smith', 'City Council'),
      senderName: 'Mary Ann Smith',
      candidateNames: ['Mary Ann Smith'],
    }

    it("replaces the model's own name-first introduction", () => {
      expect(
        openWithSmsIdentification(
          'Mary Ann Smith here, running for City Council. Vote early.',
          long,
        ),
      ).toBe('Mary Ann Smith here, candidate for City Council. Vote early.')
    })

    it.each(SOCIAL_TONE_VALUES)(
      'never stacks a second intro on a repeat pass (%s)',
      (tone) => {
        const context = {
          ...long,
          intro: identificationIntro(tone, 'Mary Ann Smith', 'City Council'),
        }
        const once = openWithSmsIdentification('Vote early.', context)
        expect(openWithSmsIdentification(once, context)).toBe(once)
      },
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

describe('withCivicPanelJoin', () => {
  const base = composeServeScript('The park cleanup is Saturday.')

  it('puts the ask in its own paragraph, above the opt-out', () => {
    expect(withCivicPanelJoin(base, true)).toBe(
      `Hello {{first_name}}, The park cleanup is Saturday.\n\n${CIVIC_PANEL_JOIN_LINE}\n\n${OPT_OUT_FOOTER}`,
    )
  })

  it('explains what joining means', () => {
    expect(CIVIC_PANEL_JOIN_LINE).toMatch(/about once a month/)
    expect(CIVIC_PANEL_JOIN_LINE).toMatch(/what you think/)
  })

  // A draft saved before the line was rewritten carries an earlier wording.
  it.each(CIVIC_PANEL_JOIN_LINES.slice(1))(
    'reads an earlier wording as asked, and locks and removes it: %s',
    (legacy) => {
      const asked = base.replace(
        OPT_OUT_FOOTER,
        `${legacy}\n\n${OPT_OUT_FOOTER}`,
      )
      expect(withCivicPanelJoin(asked, true)).toBe(asked)
      expect(withCivicPanelJoin(asked, false)).toBe(base)
      expect(
        deriveSmsProtectedParts(asked, { channel: 'serve' }).find(
          (candidate) => candidate.rule === 'civic_panel_join',
        ),
      ).toMatchObject({ text: legacy, start: asked.indexOf(legacy) })
    },
  )

  it('takes it back out and leaves the message as it was', () => {
    expect(withCivicPanelJoin(withCivicPanelJoin(base, true), false)).toBe(base)
  })

  it('does nothing when the message already matches', () => {
    expect(withCivicPanelJoin(base, false)).toBe(base)
    const asked = withCivicPanelJoin(base, true)
    expect(withCivicPanelJoin(asked, true)).toBe(asked)
  })

  it('locks the ask so it cannot be edited out from under the reply reader', () => {
    const asked = withCivicPanelJoin(base, true)
    const part = deriveSmsProtectedParts(asked, { channel: 'serve' }).find(
      (candidate) => candidate.rule === 'civic_panel_join',
    )
    expect(part).toMatchObject({
      text: CIVIC_PANEL_JOIN_LINE,
      start: asked.indexOf(CIVIC_PANEL_JOIN_LINE),
    })
  })
})

describe('withCivicPanelLeave', () => {
  const base = composeServeScript('What do you think about the park?')

  it('puts the LEAVE line in its own paragraph, above the opt-out', () => {
    expect(withCivicPanelLeave(base, true)).toBe(
      `Hello {{first_name}}, What do you think about the park?\n\n${CIVIC_PANEL_LEAVE_LINE}\n\n${OPT_OUT_FOOTER}`,
    )
  })

  it('takes it back out and leaves the message as it was', () => {
    expect(withCivicPanelLeave(withCivicPanelLeave(base, true), false)).toBe(
      base,
    )
    const offered = withCivicPanelLeave(base, true)
    expect(withCivicPanelLeave(offered, true)).toBe(offered)
  })

  it('never leaves both lines in a message', () => {
    const asked = withCivicPanelJoin(base, true)
    const offered = withCivicPanelLeave(asked, true)
    expect(offered).not.toContain(CIVIC_PANEL_JOIN_LINE)
    expect(offered).toContain(CIVIC_PANEL_LEAVE_LINE)
    const backToJoin = withCivicPanelLines(offered, {
      join: true,
      leave: false,
    })
    expect(backToJoin).toBe(asked)
    expect(withCivicPanelLines(offered, { join: true, leave: true })).toBe(
      offered,
    )
  })

  it('locks the line and counts it in the length', () => {
    const offered = withCivicPanelLeave(base, true)
    expect(
      deriveSmsProtectedParts(offered, { channel: 'serve' }).find(
        (candidate) => candidate.rule === 'civic_panel_leave',
      ),
    ).toMatchObject({
      text: CIVIC_PANEL_LEAVE_LINE,
      start: offered.indexOf(CIVIC_PANEL_LEAVE_LINE),
    })
    expect(offered.length).toBe(base.length + CIVIC_PANEL_LEAVE_LINE.length + 2)
  })
})

// Every path that rewrites a panel text ends in withCivicPanelLines, so its
// output must hold exactly one panel line, above one opt-out, whatever the
// model or an earlier bug left in the message.
describe('the civic panel line after a rewrite', () => {
  const body = 'Hello {{first_name}}, tell me what you think.'
  const asked = `${body}\n\n${CIVIC_PANEL_JOIN_LINE}\n\n${OPT_OUT_FOOTER}`
  const join = { join: true, leave: false }
  const leave = { join: false, leave: true }

  it('collapses a JOIN line sent twice into one, above the opt-out', () => {
    expect(
      withCivicPanelLines(
        `${body}\n\n${CIVIC_PANEL_JOIN_LINE}\n\n${CIVIC_PANEL_JOIN_LINE}\n\n${OPT_OUT_FOOTER}`,
        join,
      ),
    ).toBe(asked)
  })

  it('moves a JOIN line the model left in the body down above the opt-out', () => {
    expect(
      withCivicPanelLines(
        `Hello {{first_name}}, tell me what you think. ${CIVIC_PANEL_JOIN_LINE}\n\n${OPT_OUT_FOOTER}`,
        join,
      ),
    ).toBe(asked)
  })

  it('drops a partial echo of the ask', () => {
    expect(
      withCivicPanelLines(
        `${body} Reply JOIN to join my civic panel!\n\n${CIVIC_PANEL_JOIN_LINE}\n\n${OPT_OUT_FOOTER}`,
        join,
      ),
    ).toBe(asked)
  })

  it.each(CIVIC_PANEL_JOIN_LINES.slice(1))(
    'replaces an earlier wording sitting beside the current one: %s',
    (legacy) => {
      expect(
        withCivicPanelLines(
          `${body}\n\n${legacy}\n\n${CIVIC_PANEL_JOIN_LINE}\n\n${OPT_OUT_FOOTER}`,
          join,
        ),
      ).toBe(asked)
    },
  )

  it('swaps every JOIN copy for one LEAVE line on a panel-only list', () => {
    expect(
      withCivicPanelLines(
        `${body} ${CIVIC_PANEL_JOIN_LINE}\n\n${CIVIC_PANEL_JOIN_LINE}\n\n${OPT_OUT_FOOTER}`,
        leave,
      ),
    ).toBe(`${body}\n\n${CIVIC_PANEL_LEAVE_LINE}\n\n${OPT_OUT_FOOTER}`)
  })

  it('collapses a LEAVE line sent twice', () => {
    expect(
      withCivicPanelLines(
        `${body}\n\n${CIVIC_PANEL_LEAVE_LINE}\n\n${CIVIC_PANEL_LEAVE_LINE}\n\n${OPT_OUT_FOOTER}`,
        leave,
      ),
    ).toBe(`${body}\n\n${CIVIC_PANEL_LEAVE_LINE}\n\n${OPT_OUT_FOOTER}`)
  })

  it('composes a fresh body that echoed the JOIN and STOP lines once each', () => {
    expect(
      withCivicPanelLines(
        composeServeScript(
          `tell me what you think.\n\n${CIVIC_PANEL_JOIN_LINE}\n\n${OPT_OUT_FOOTER}`,
        ),
        join,
      ),
    ).toBe(asked)
  })

  it('composes a Win body that echoed its footer with one footer', () => {
    const footer = 'Paid for by Friends of Sarah Chen. Reply STOP to opt out.'
    expect(
      composeScript(`Vote Tuesday.\n\n${footer}`, 'Friends of Sarah Chen'),
    ).toBe(`Hello {first_name}, Vote Tuesday.\n\n${footer}`)
  })

  // The reported bug: an Improve reply comes back whole, JOIN line included.
  // Restored against the footer alone and then given its panel line, it
  // keeps one ask and its opt-out.
  it('restores a whole polish of a panel text with one ask and its opt-out', () => {
    const reply = `Hello {{first_name}}, I want to hear from you.\n\n${CIVIC_PANEL_JOIN_LINE}\n\n${OPT_OUT_FOOTER}`
    const restored = restoreSmsSystemRegions(reply, {
      greeting: 'Hello {{first_name}},',
      footer: OPT_OUT_FOOTER,
      token: '{{first_name}}',
    })
    expect(restored).not.toContain(CIVIC_PANEL_JOIN_LINE)
    expect(withCivicPanelLines(restored, join)).toBe(reply)
  })

  it('restores a polish that dropped the opt-out but kept the ask', () => {
    const restored = restoreSmsSystemRegions(
      `Hello {{first_name}}, I want to hear from you.\n\n${CIVIC_PANEL_JOIN_LINE}`,
      {
        greeting: 'Hello {{first_name}},',
        footer: OPT_OUT_FOOTER,
        token: '{{first_name}}',
      },
    )
    expect(withCivicPanelLines(restored, join)).toBe(
      `Hello {{first_name}}, I want to hear from you.\n\n${CIVIC_PANEL_JOIN_LINE}\n\n${OPT_OUT_FOOTER}`,
    )
  })
})

describe('a retyped opt-out with STOP in quotes', () => {
  const quoted = 'Reply "STOP" to opt out.'
  const body = 'Hello {{first_name}}, tell me what you think.'

  it('takes the panel line above it, not below', () => {
    expect(
      withCivicPanelLines(`${body}\n\n${quoted}`, {
        join: true,
        leave: false,
      }),
    ).toBe(`${body}\n\n${CIVIC_PANEL_JOIN_LINE}\n\n${quoted}`)
  })

  it('is read as the footer of a polish, so no second opt-out is added', () => {
    expect(
      restoreSmsSystemRegions(`${body}\n\n${quoted}`, {
        greeting: 'Hello {{first_name}},',
        footer: OPT_OUT_FOOTER,
        token: '{{first_name}}',
      }),
    ).toBe(`${body}\n\n${OPT_OUT_FOOTER}`)
  })

  it('is dropped from a drafted body like the exact line', () => {
    expect(composeServeScript(`tell me what you think. ${quoted}`)).toBe(
      `${body}\n\n${OPT_OUT_FOOTER}`,
    )
  })
})

describe('add it back', () => {
  it('puts the opt-out back as the last line, after the panel line', () => {
    expect(
      addOptOutBack(`Hello {{first_name}}, hi.\n\n${CIVIC_PANEL_JOIN_LINE}\n`),
    ).toBe(
      `Hello {{first_name}}, hi.\n\n${CIVIC_PANEL_JOIN_LINE}\n\n${OPT_OUT_FOOTER}`,
    )
  })

  it('puts the opt-out back on a closing "Paid for by" line', () => {
    expect(
      addOptOutBack('Hello {first_name}, hi.\n\nPaid for by Friends of Sarah.'),
    ).toBe(
      `Hello {first_name}, hi.\n\nPaid for by Friends of Sarah. ${OPT_OUT_FOOTER}`,
    )
  })

  it('puts the greeting back at the start', () => {
    expect(addGreetingBack('  this is Jane.', 'Hello {{first_name}},')).toBe(
      'Hello {{first_name}}, this is Jane.',
    )
  })

  it('puts the disclaimer back just before the opt-out', () => {
    expect(
      addPaidForByBack(
        `Hello {first_name}, hi.\n\n${OPT_OUT_FOOTER}`,
        'Friends of Sarah',
      ),
    ).toBe(
      `Hello {first_name}, hi.\n\nPaid for by Friends of Sarah. ${OPT_OUT_FOOTER}`,
    )
  })

  it('puts the disclaimer back as the last line when there is no opt-out', () => {
    expect(
      addPaidForByBack('Hello {first_name}, hi.', 'Friends of Sarah'),
    ).toBe('Hello {first_name}, hi.\n\nPaid for by Friends of Sarah.')
  })

  it('puts the name back right after the greeting', () => {
    const regions = {
      greeting: 'Hello {{first_name}},',
      intro: 'this is Jane, your Mayor.',
    }
    expect(
      addIdentificationBack('Hello {{first_name}}, the park opens.', regions),
    ).toBe('Hello {{first_name}}, this is Jane, your Mayor. the park opens.')
    expect(addIdentificationBack('The park opens.', regions)).toBe(
      'this is Jane, your Mayor. The park opens.',
    )
  })
})

describe('profilePhotoFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const stubOversizedPhoto = (type = 'image/jpeg') => {
    const photo = new Blob([new Uint8Array(IMAGE_MAX_BYTES + 1)], { type })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, blob: async () => photo }),
    )
    const bitmap = { width: 3000, height: 1500, close: vi.fn() }
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap))
    return bitmap
  }

  // Each toBlob call answers with the next size, recording the canvas it
  // drew from and the quality it was asked for.
  const stubJpegSizes = (sizes: number[]) => {
    const calls: { width: number; height: number; quality?: number }[] = []
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
      function (this: HTMLCanvasElement, callback, _type, quality) {
        calls.push({ width: this.width, height: this.height, quality })
        const size = sizes[calls.length - 1] ?? 0
        callback(new Blob([new Uint8Array(size)], { type: 'image/jpeg' }))
      },
    )
    return calls
  }

  it('redraws an oversized photo as a JPEG under the cap', async () => {
    const bitmap = stubOversizedPhoto()
    const calls = stubJpegSizes([IMAGE_MAX_BYTES + 1, 400_000])

    const file = await profilePhotoFile('https://assets.example/large.jpg')

    expect(file?.type).toBe('image/jpeg')
    expect(file?.size).toBe(400_000)
    expect(calls).toEqual([
      { width: 1024, height: 512, quality: 0.85 },
      { width: 1024, height: 512, quality: 0.7 },
    ])
    expect(bitmap.close).toHaveBeenCalled()
  })

  it('redraws a photo in a format texts cannot carry', async () => {
    const photo = new Blob(['webp-bytes'], { type: 'image/webp' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, blob: async () => photo }),
    )
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn().mockResolvedValue({ width: 400, height: 300, close: vi.fn() }),
    )
    const calls = stubJpegSizes([50_000])

    const file = await profilePhotoFile('https://assets.example/avatar.webp')

    expect(file?.type).toBe('image/jpeg')
    expect(calls).toEqual([{ width: 400, height: 300, quality: 0.85 }])
  })

  it('leaves the image blank when no quality fits under the cap', async () => {
    stubOversizedPhoto()
    const calls = stubJpegSizes([
      IMAGE_MAX_BYTES + 1,
      IMAGE_MAX_BYTES + 1,
      IMAGE_MAX_BYTES + 1,
    ])

    expect(
      await profilePhotoFile('https://assets.example/large.jpg'),
    ).toBeNull()
    expect(calls.map((call) => call.quality)).toEqual([0.85, 0.7, 0.5])
  })

  it('attaches a photo that already fits as-is', async () => {
    const photo = new Blob(['jpeg-bytes'], { type: 'image/jpeg' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, blob: async () => photo }),
    )

    const file = await profilePhotoFile('https://assets.example/avatar.jpg')

    expect(file?.type).toBe('image/jpeg')
    expect(file?.size).toBe(photo.size)
    expect(file?.size).toBeLessThanOrEqual(IMAGE_MAX_BYTES)
  })

  it('leaves the image blank when the photo cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))

    expect(
      await profilePhotoFile('https://assets.example/avatar.jpg'),
    ).toBeNull()
  })

  it('leaves the image blank when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('CORS')))

    expect(
      await profilePhotoFile('https://assets.example/avatar.jpg'),
    ).toBeNull()
  })
})
