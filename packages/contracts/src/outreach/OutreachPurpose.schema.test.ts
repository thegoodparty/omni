import { describe, expect, it } from 'vitest'
import {
  OUTREACH_PURPOSE_VALUES,
  SERVE_OUTREACH_PURPOSE_VALUES,
} from './OutreachPurpose.schema'
import { SMS_PURPOSE_VALUES } from './OutreachSms.schema'
import { ROBOCALL_PURPOSE_VALUES } from './RobocallScript.schema'
import { SOCIAL_PURPOSE_VALUES } from './OutreachSocial.schema'
import {
  PHONE_BANKING_PURPOSE_VALUES,
  SERVE_PHONE_BANKING_PURPOSE_VALUES,
} from '../phoneBanking/PhoneBankingCreate.schema'

describe('outreach purpose vocabulary', () => {
  it('is one shared list across every win channel', () => {
    expect(SMS_PURPOSE_VALUES).toEqual(OUTREACH_PURPOSE_VALUES)
    expect(ROBOCALL_PURPOSE_VALUES).toEqual(OUTREACH_PURPOSE_VALUES)
    expect(PHONE_BANKING_PURPOSE_VALUES).toEqual(OUTREACH_PURPOSE_VALUES)
  })

  it('is one shared list across every serve channel', () => {
    expect(SERVE_PHONE_BANKING_PURPOSE_VALUES).toEqual(
      SERVE_OUTREACH_PURPOSE_VALUES,
    )
  })

  it('lets social add issue_update without forking the list', () => {
    expect(SOCIAL_PURPOSE_VALUES).toEqual([
      ...OUTREACH_PURPOSE_VALUES,
      'issue_update',
    ])
  })

  it('keeps serve on its own list with the shared slugs renamed', () => {
    expect(SERVE_OUTREACH_PURPOSE_VALUES).toContain('introduce_myself')
    expect(SERVE_OUTREACH_PURPOSE_VALUES).toContain('event_invite')
    expect(SERVE_OUTREACH_PURPOSE_VALUES).not.toContain('early_voting')
    expect(SERVE_OUTREACH_PURPOSE_VALUES).not.toContain('election_day_turnout')
  })

  it('needs no kebab-to-snake translation', () => {
    for (const value of OUTREACH_PURPOSE_VALUES) {
      expect(value).toMatch(/^[a-z][a-z0-9_]*$/)
    }
  })
})
