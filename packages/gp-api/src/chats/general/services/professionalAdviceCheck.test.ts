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
      'a texting opt-in-consent question',
      'No, you do not need opt-in consent before texting your list.',
    ],
    [
      'a robocall-compliance question',
      'Robocalls to this list are legal at that volume.',
    ],
    ['a TCPA question', 'TCPA rules allow that many calls per day.'],
    [
      'a 10DLC question',
      '10DLC registration is required for a campaign this size.',
    ],
    [
      'a contribution-limit exemption question',
      'That contribution limit does not apply to a self-funded loan.',
    ],
    [
      'a campaign-finance-rules question',
      'Campaign finance rules require a report every quarter.',
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
  ])('stays quiet on %s', (_label, input) => {
    expect(professionalAdviceDisclaimer(input)).toBeNull()
  })

  it('does not double the line when the model already disclaimed', () => {
    expect(
      professionalAdviceDisclaimer(
        'RCW 42.56 applies. This is not a substitute for professional ' +
          'advice; confirm with a qualified professional.',
      ),
    ).toBeNull()
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

  it('skips the line when a reply says not to rely on it', () => {
    expect(
      professionalAdviceDisclaimer(
        'TCPA rules allow that call volume. Do not rely on my answer ' +
          'alone for a legal compliance question; verify it with ' +
          'support.',
      ),
    ).toBeNull()
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

  it('returns null for empty or whitespace text', () => {
    expect(professionalAdviceDisclaimer('')).toBeNull()
    expect(professionalAdviceDisclaimer('   \n ')).toBeNull()
  })
})
