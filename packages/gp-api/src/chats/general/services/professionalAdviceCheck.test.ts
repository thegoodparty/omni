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

  it('appends on campaign-law terms (texting, robocall, finance)', () => {
    expect(
      professionalAdviceDisclaimer(
        'No, you do not need opt-in consent before texting your list.',
      ),
    ).toBe(appended)
    expect(
      professionalAdviceDisclaimer(
        'Robocalls to this list are fine under the TCPA at that volume, ' +
          'and 10DLC registration is optional for a campaign this size.',
      ),
    ).toBe(appended)
    expect(
      professionalAdviceDisclaimer(
        'That contribution limit does not apply to a self-funded loan, ' +
          'and campaign finance rules skip the disclaimer requirement on ' +
          'a text that short.',
      ),
    ).toBe(appended)
    expect(
      professionalAdviceDisclaimer(
        'You can skip that filing deadline since the office reopens it ' +
          'every cycle.',
      ),
    ).toBe(appended)
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

  it('stays quiet on a text-message script and a fundraising plan', () => {
    expect(
      professionalAdviceDisclaimer(
        'Hi Jordan, quick reminder to vote Tuesday! Reply STOP to opt out.',
      ),
    ).toBeNull()
    expect(
      professionalAdviceDisclaimer(
        'Your fundraising plan: three email asks this week, a text blast ' +
          'this weekend, and a thank-you call to your top donors Monday.',
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

  it(
    'does not double the line when a reply names the election office ' +
      'or an election attorney',
    () => {
      expect(
        professionalAdviceDisclaimer(
          'That contribution limit is $1,000. Do not rely on my answer ' +
            'alone for a legal compliance question; confirm with your ' +
            'state election board.',
        ),
      ).toBeNull()
      expect(
        professionalAdviceDisclaimer(
          'RCW 42.17A applies here. Check with an election attorney ' +
            'before you rely on this.',
        ),
      ).toBeNull()
    },
  )

  it('returns null for empty or whitespace text', () => {
    expect(professionalAdviceDisclaimer('')).toBeNull()
    expect(professionalAdviceDisclaimer('   \n ')).toBeNull()
  })
})
