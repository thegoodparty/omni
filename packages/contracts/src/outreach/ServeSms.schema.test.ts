import { describe, expect, it } from 'vitest'
import {
  ServeSmsCreateRequestSchema,
  ServeSmsDraftRequestSchema,
} from './ServeSms.schema'
import { SMS_COMPOSED_MAX_LENGTH } from './OutreachSms.schema'

describe('ServeSmsDraftRequestSchema', () => {
  it('takes the serve purpose vocabulary', () => {
    expect(
      ServeSmsDraftRequestSchema.parse({
        purpose: 'community_input',
        tone: 'warm',
      }).purpose,
    ).toBe('community_input')
  })

  // The Win/Serve boundary, not a formality: serve carries no election
  // mechanics, so the Win-only turnout purposes must not typecheck or parse
  // on this surface.
  it.each(['early_voting', 'election_day_turnout', 'persuade_voters'])(
    'rejects the Win-only purpose %s',
    (purpose) => {
      expect(
        ServeSmsDraftRequestSchema.safeParse({ purpose, tone: 'warm' }).success,
      ).toBe(false)
    },
  )

  it('caps an improve draft at the shared composed length', () => {
    const tooLong = 'a'.repeat(SMS_COMPOSED_MAX_LENGTH + 1)
    expect(
      ServeSmsDraftRequestSchema.safeParse({
        purpose: 'custom',
        tone: 'warm',
        currentDraft: tooLong,
      }).success,
    ).toBe(false)
  })
})

describe('ServeSmsCreateRequestSchema', () => {
  const valid = {
    name: 'Ward 3 street repair update',
    message: 'Hello {first_name}, ...',
    scheduledLocalDate: '2026-10-05',
    voterFileFilterId: 42,
  }

  it('accepts a local calendar day', () => {
    expect(ServeSmsCreateRequestSchema.parse(valid).scheduledLocalDate).toBe(
      '2026-10-05',
    )
  })

  // Serve sends at a fixed 11am local, so the payload carries a day and not
  // an instant. An ISO datetime here would silently reintroduce a time the
  // product does not honor.
  it('rejects an ISO datetime as the send day', () => {
    expect(
      ServeSmsCreateRequestSchema.safeParse({
        ...valid,
        scheduledLocalDate: '2026-10-05T11:00:00.000Z',
      }).success,
    ).toBe(false)
  })

  it('requires a saved list', () => {
    const { voterFileFilterId: _omitted, ...withoutList } = valid
    expect(ServeSmsCreateRequestSchema.safeParse(withoutList).success).toBe(
      false,
    )
  })
})
