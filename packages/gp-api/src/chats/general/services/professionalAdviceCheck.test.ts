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
    ['a TCPA question', 'That call volume is fine under the TCPA.'],
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
      'There is no disclaimer requirement on a text message that short.',
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

  it('stays quiet on routine mentions of the tightened terms', () => {
    expect(
      professionalAdviceDisclaimer(
        'Your last two texts had a 42% opt-in rate, up from 35%.',
      ),
    ).toBeNull()
    expect(
      professionalAdviceDisclaimer(
        'Your robocall to 500 voters went out this morning.',
      ),
    ).toBeNull()
    expect(
      professionalAdviceDisclaimer(
        'Your 10DLC registration cleared this morning, so your texts ' +
          'are sending now.',
      ),
    ).toBeNull()
    expect(
      professionalAdviceDisclaimer(
        'Your filing deadline is March 1, about six weeks away.',
      ),
    ).toBeNull()
    expect(
      professionalAdviceDisclaimer(
        'Your campaign finance report is due at the end of the quarter.',
      ),
    ).toBeNull()
  })

  it('does not double the line when the model already disclaimed', () => {
    expect(
      professionalAdviceDisclaimer(
        'RCW 42.56 applies. This is not a substitute for professional ' +
          'advice; confirm with a qualified professional.',
      ),
    ).toBeNull()
  })

  it('skips the line when a reply names an election contact', () => {
    expect(
      professionalAdviceDisclaimer(
        'That contribution limit does not apply to a self-funded loan. ' +
          'Do not rely on my answer alone for a legal compliance ' +
          'question; confirm with your state election board.',
      ),
    ).toBeNull()
    expect(
      professionalAdviceDisclaimer(
        'RCW 42.17A applies here. Check with an election attorney ' +
          'before you rely on this.',
      ),
    ).toBeNull()
    expect(
      professionalAdviceDisclaimer(
        'There is no disclaimer requirement on a text message that ' +
          'short. Confirm with your election office before you rely on ' +
          'this.',
      ),
    ).toBeNull()
    expect(
      professionalAdviceDisclaimer(
        'Campaign finance rules require a report every quarter. Check ' +
          'with your election bureau before you rely on this.',
      ),
    ).toBeNull()
  })

  it('still appends despite an unrelated office mention', () => {
    expect(
      professionalAdviceDisclaimer(
        'The election office also handles yard-sign permits. Robocalls ' +
          'are fine at that volume under the TCPA.',
      ),
    ).toBe(appended)
  })

  it('returns null for empty or whitespace text', () => {
    expect(professionalAdviceDisclaimer('')).toBeNull()
    expect(professionalAdviceDisclaimer('   \n ')).toBeNull()
  })
})
