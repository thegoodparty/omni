import { describe, expect, it } from 'vitest'
import {
  EmailDraftSaveSchema,
  EmailRecipientUploadRequestSchema,
} from './OutreachEmail.schema'

const base = {
  goal: 'Invite neighbors to the town hall',
  layout: 'newsletter',
  theme: 'classic_blue',
  subject: 'Town hall on Thursday',
  body: 'Join us.',
}

describe('EmailDraftSaveSchema', () => {
  it('accepts a newsletter without a button', () => {
    expect(EmailDraftSaveSchema.safeParse(base).success).toBe(true)
  })

  it('requires a button on call to action', () => {
    const result = EmailDraftSaveSchema.safeParse({
      ...base,
      layout: 'call_to_action',
    })
    expect(result.success).toBe(false)
  })

  it('accepts a call to action with a label and https link', () => {
    const result = EmailDraftSaveSchema.safeParse({
      ...base,
      layout: 'call_to_action',
      buttonLabel: 'RSVP',
      buttonUrl: 'https://example.com/rsvp',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a button link that is not https', () => {
    const result = EmailDraftSaveSchema.safeParse({
      ...base,
      buttonLabel: 'RSVP',
      buttonUrl: 'http://example.com/rsvp',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a label without a link', () => {
    const result = EmailDraftSaveSchema.safeParse({
      ...base,
      buttonLabel: 'RSVP',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a layout or theme outside the registries', () => {
    expect(
      EmailDraftSaveSchema.safeParse({ ...base, layout: 'poster' }).success,
    ).toBe(false)
    expect(
      EmailDraftSaveSchema.safeParse({ ...base, theme: 'neon' }).success,
    ).toBe(false)
  })

  it('caps the subject at 150 characters', () => {
    expect(
      EmailDraftSaveSchema.safeParse({ ...base, subject: 'a'.repeat(151) })
        .success,
    ).toBe(false)
  })
})

describe('EmailRecipientUploadRequestSchema', () => {
  it('accepts the multipart string and the boolean', () => {
    expect(
      EmailRecipientUploadRequestSchema.parse({ consentConfirmed: 'true' }),
    ).toEqual({ consentConfirmed: true })
    expect(
      EmailRecipientUploadRequestSchema.parse({ consentConfirmed: true }),
    ).toEqual({ consentConfirmed: true })
  })

  it('refuses a missing or false consent', () => {
    expect(EmailRecipientUploadRequestSchema.safeParse({}).success).toBe(false)
    expect(
      EmailRecipientUploadRequestSchema.safeParse({ consentConfirmed: 'false' })
        .success,
    ).toBe(false)
  })
})
