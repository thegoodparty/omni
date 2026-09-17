import { describe, expect, it } from 'vitest'
import {
  PROFESSIONAL_ADVICE_DISCLAIMER,
  professionalAdviceDisclaimer,
} from './professionalAdviceCheck'

describe('professionalAdviceDisclaimer', () => {
  const appended = `\n\n${PROFESSIONAL_ADVICE_DISCLAIMER}`

  it('appends on a statute citation', () => {
    expect(
      professionalAdviceDisclaimer(
        'Under RCW 42.56.070 the record is disclosable on request.',
      ),
    ).toBe(appended)
    expect(professionalAdviceDisclaimer('See § 5.12.030 of the code.')).toBe(
      appended,
    )
    expect(
      professionalAdviceDisclaimer('This is governed by 52 U.S.C. 30101.'),
    ).toBe(appended)
    expect(professionalAdviceDisclaimer('See 47 Stat. 454 for that.')).toBe(
      appended,
    )
  })

  it('appends on liability characterization and filing language', () => {
    expect(
      professionalAdviceDisclaimer(
        'Your colleague could face criminal liability for that vote.',
      ),
    ).toBe(appended)
    expect(
      professionalAdviceDisclaimer(
        'You can file a complaint with the state ethics board.',
      ),
    ).toBe(appended)
  })

  it.each([
    [
      'a texting opt-in-consent question (hyphen)',
      'No, you do not need opt-in consent before texting your list.',
    ],
    [
      'a texting opt-in-consent question (space)',
      'No, you do not need opt in consent before texting your list.',
    ],
    [
      'an opt-in-consent-is-required claim',
      'Opt-in consent is required before you text that list.',
    ],
    [
      'a texting-without-consent claim',
      'You can text them without opt-in consent under P2P rules.',
    ],
    [
      'a robocall-compliance question',
      'Robocalls to this list are legal at that volume.',
    ],
    [
      'a robocall-compliance question (hyphenated)',
      'Robo-calls to this list are legal at that volume.',
    ],
    ['a TCPA question', 'TCPA rules allow that many calls per day.'],
    [
      'a 10DLC question',
      '10DLC registration is required for a campaign this size.',
    ],
    [
      'a 10DLC question (spaced)',
      '10 DLC registration is required for a campaign this size.',
    ],
    [
      'a contribution-limit exemption question',
      'That contribution limit does not apply to a self-funded loan.',
    ],
    [
      'a contribution-limit scope claim',
      'The contribution limit applies to PAC money as well.',
    ],
    [
      'a campaign-finance-rules question',
      'Campaign finance rules require a report every quarter.',
    ],
    [
      'a campaign-finance-rules question (hyphenated)',
      'Campaign-finance rules require a report every quarter.',
    ],
    [
      'a disclaimer-requirement question',
      'That disclaimer requirement does not apply to a text message ' +
        'this short.',
    ],
    [
      'a filing-deadline exemption question',
      'You can skip that filing deadline since the office reopens it ' +
        'every cycle.',
    ],
    [
      'a filing-deadline waiver claim',
      'They will not waive the filing deadline for a late form.',
    ],
    [
      'a statute-of-limitations claim',
      'The statute of limitations on that claim is three years.',
    ],
    [
      'a civil-liability characterization',
      'That vote creates civil liability for the city.',
    ],
    [
      'a "civilly liable" characterization',
      'You could be held civilly liable for that.',
    ],
  ])('appends on %s', (_label, input) => {
    expect(professionalAdviceDisclaimer(input)).toBe(appended)
  })

  it('stays quiet on ordinary office prose', () => {
    expect(
      professionalAdviceDisclaimer(
        'Turnout in your district was about 65% last cycle, up from 61%.',
      ),
    ).toBeNull()
    expect(
      professionalAdviceDisclaimer(
        "Here's a draft note to the constituent about their pothole complaint.",
      ),
    ).toBeNull()
  })

  it('stays quiet on a text-message script', () => {
    expect(
      professionalAdviceDisclaimer(
        'Hi Jordan, quick reminder to vote Tuesday! Reply STOP to opt out.',
      ),
    ).toBeNull()
  })

  it('stays quiet on a fundraising plan', () => {
    expect(
      professionalAdviceDisclaimer(
        'Your fundraising plan: three email asks this week, a text blast ' +
          'this weekend, and a thank-you call to your top donors Monday.',
      ),
    ).toBeNull()
  })

  it.each([
    [
      'an opt-in-rate report',
      'Your last two texts had a 42% opt-in rate, up from 35%.',
    ],
    [
      'a routine robocall status update',
      'Your robocall to 500 voters went out this morning.',
    ],
    ['a robocall going "fine"', 'The robocall went out fine this time.'],
    ['a TCPA status update', 'Your TCPA registration is active.'],
    [
      'a 10DLC status update',
      'Your 10DLC registration cleared this morning, so your texts ' +
        'are sending now.',
    ],
    [
      'a routine filing-deadline mention',
      'Your filing deadline is March 1, about six weeks away.',
    ],
    [
      'a filing deadline you might miss',
      "You'll miss the filing deadline if you wait much longer.",
    ],
    [
      'a campaign-finance-report reminder',
      'Your campaign finance report is due at the end of the quarter.',
    ],
    [
      'a campaign-finance-rules link',
      "Here's a link to your state's campaign finance rules.",
    ],
    [
      'a disclaimer-requirement setting',
      'The disclaimer requirement checkbox is enabled in your campaign.',
    ],
    [
      'an opt-in-consent checkbox setting',
      'The opt-in consent checkbox on your website signup form is enabled.',
    ],
    [
      'a stored opt-in-consent record',
      'Peerly stores each opt-in consent record next to the contact.',
    ],
    [
      'a TCPA consent-language status',
      'Your TCPA consent language is already included in the signup form.',
    ],
    [
      'a robocall plan-gating answer',
      "Robocalls aren't allowed on the free plan; upgrade to Pro to " +
        'unlock them.',
    ],
    [
      'a robocall consent-record status',
      'Robocall consent records are attached to each contact.',
    ],
    [
      'a contribution-limit checkout feature',
      'The contribution limit applies automatically at checkout on your ' +
        'donate page.',
    ],
    [
      'a contribution-limit amount',
      'The contribution limit for your race is $500 per donor.',
    ],
    [
      'an announced filing-deadline extension',
      'The Secretary of State announced it will extend the filing ' +
        'deadline to March 8.',
    ],
    [
      'a constituent-services complaint pointer',
      'Residents can file a complaint with Public Works through the 311 ' +
        'portal.',
    ],
    [
      'an ad-platform complaint pointer',
      'You can file a complaint with Meta Business Support about the ' +
        'rejected ad.',
    ],
    [
      'an agenda item about a liability claim',
      'Item 7: settlement of the civil liability claim from the 2024 ' +
        'sidewalk fall.',
    ],
    [
      'a liability-insurance renewal',
      'The city renews its legal liability insurance policy in June.',
    ],
    [
      'a bill named for the statute of limitations',
      'Agenda item 3 is a resolution supporting the statute of ' +
        'limitations reform bill.',
    ],
    ['"Stat." as urgency slang', 'Send the press release out. Stat.'],
    [
      '"Stat." as an abbreviation',
      'Stat. Board of Elections requires a report by Friday.',
    ],
  ])('stays quiet on %s', (_label, input) => {
    expect(professionalAdviceDisclaimer(input)).toBeNull()
  })

  it.each([
    [
      'says it is not a substitute for professional advice',
      'RCW 42.56 applies. This is not a substitute for professional advice.',
    ],
    [
      "says it isn't a substitute for professional counsel",
      "RCW 42.56 applies. This isn't a substitute for professional counsel.",
    ],
    [
      'tells the reader to consult a qualified professional',
      'RCW 42.56 applies. Consult a qualified professional before you act.',
    ],
    [
      'tells the reader to seek legal counsel before acting',
      'RCW 42.17A applies. Seek legal counsel before you act on this.',
    ],
    [
      'says not to rely on it',
      'TCPA rules allow that call volume. Do not rely on my answer ' +
        'alone for a legal compliance question; verify it with support.',
    ],
    [
      'points to the election office before relying on it',
      'TCPA rules allow that call volume. Confirm with your election ' +
        'office before relying on this.',
    ],
  ])('skips the line when a reply %s', (_label, input) => {
    expect(professionalAdviceDisclaimer(input)).toBeNull()
  })

  it.each([
    [
      'the state election board',
      'That contribution limit does not apply to a self-funded loan. ' +
        'Confirm with your state election board before you rely on this.',
    ],
    [
      'an election attorney',
      'RCW 42.17A applies here. Check with an election attorney before ' +
        'you rely on this.',
    ],
    [
      'the election office',
      'TCPA rules allow that many calls per day. Confirm with your ' +
        'election office before you rely on this.',
    ],
    [
      'the election bureau',
      'Campaign finance rules require a report every quarter. Check ' +
        'with your election bureau before you rely on this.',
    ],
  ])('skips the line when a reply names %s', (_label, input) => {
    expect(professionalAdviceDisclaimer(input)).toBeNull()
  })

  it('still appends despite an unrelated office mention', () => {
    expect(
      professionalAdviceDisclaimer(
        'The election office also handles yard-sign permits. Robocalls ' +
          'are legal at that volume.',
      ),
    ).toBe(appended)
  })

  it('still appends when the office check is only operational', () => {
    expect(
      professionalAdviceDisclaimer(
        'Check the election office hours before you go. Robocalls are ' +
          'legal at that volume.',
      ),
    ).toBe(appended)
  })

  it('still appends when "rely on" only follows past a sentence break', () => {
    expect(
      professionalAdviceDisclaimer(
        'Check the election office hours! You can rely on same-day ' +
          'registration for this event. Robocalls are legal at that ' +
          'volume.',
      ),
    ).toBe(appended)
  })

  it.each([
    [
      'compares tactics with "not a substitute for"',
      "Robocalls are legal at that volume, but they're not a substitute " +
        'for door knocking.',
    ],
    [
      'describes a qualified professional photographer',
      'Hire a qualified professional photographer for your headshots. ' +
        'Robocalls are legal at that volume.',
    ],
    [
      'drafts a reply that says to seek legal help elsewhere',
      'Under RCW 59.18.290 the notice period is 20 days. Draft: "Please ' +
        'seek legal help through the county tenant hotline."',
    ],
    [
      'warns about a response rate, not the answer',
      "Don't rely on this response rate to size the next blast. TCPA " +
        'rules allow that volume.',
    ],
    [
      'checks with the office about voters who rely on mail ballots',
      'Confirm with the election office how many voters rely on mail ' +
        'ballots before you set the schedule. Robocalls are legal at ' +
        'that volume.',
    ],
  ])('still appends when a reply %s', (_label, input) => {
    expect(professionalAdviceDisclaimer(input)).toBe(appended)
  })

  it('returns null for empty or whitespace text', () => {
    expect(professionalAdviceDisclaimer('')).toBeNull()
    expect(professionalAdviceDisclaimer('   \n ')).toBeNull()
  })
})
