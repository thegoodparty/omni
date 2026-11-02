import { describe, expect, it } from 'vitest'
import {
  EmailAiDraftRequestSchema,
  EmailDraftSaveSchema,
  EmailPreviewRequestSchema,
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

describe('EmailDraftSaveSchema audience', () => {
  it('takes a voter-file list and the consent statement', () => {
    expect(
      EmailDraftSaveSchema.parse({
        ...base,
        voterFileFilterId: 12,
        consentConfirmed: true,
      }),
    ).toMatchObject({ voterFileFilterId: 12, consentConfirmed: true })
  })

  it('refuses a list id that is not a positive integer', () => {
    expect(
      EmailDraftSaveSchema.safeParse({ ...base, voterFileFilterId: 0 }).success,
    ).toBe(false)
  })
})

describe('EmailDraftSaveSchema with blocks', () => {
  const content = {
    layout: 'personal_letter',
    theme: 'cream_and_forest',
    subject: 'About Tuesday',
    blocks: [{ type: 'paragraph', text: 'Dear {{first_name}},' }],
  }

  it('takes block content instead of the fields', () => {
    expect(EmailDraftSaveSchema.safeParse({ goal: 'g', content }).success).toBe(
      true,
    )
  })

  it('refuses content and fields together', () => {
    expect(EmailDraftSaveSchema.safeParse({ ...base, content }).success).toBe(
      false,
    )
  })

  it('reports a block the layout does not allow at its path', () => {
    const result = EmailDraftSaveSchema.safeParse({
      goal: 'g',
      content: {
        ...content,
        blocks: [{ type: 'divider' }, ...content.blocks],
      },
    })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]).toMatchObject({
      path: ['content', 'blocks', 0],
      message: 'The Personal letter layout doesn’t use divider blocks',
    })
  })
})

describe('EmailPreviewRequestSchema', () => {
  it('takes either block content or the fields', () => {
    expect(
      EmailPreviewRequestSchema.safeParse({
        content: {
          layout: 'short_cta',
          theme: 'bold_red',
          subject: '',
          blocks: [],
        },
      }).success,
    ).toBe(true)
    expect(EmailPreviewRequestSchema.safeParse(base).success).toBe(false)
    expect(
      EmailPreviewRequestSchema.safeParse({
        layout: 'newsletter',
        theme: 'classic_blue',
        subject: '',
        body: '',
      }).success,
    ).toBe(true)
  })
})

describe('EmailAiDraftRequestSchema', () => {
  it('takes a layout preset or an old layout key', () => {
    const request = { goal: 'g', tone: 'warm' }
    for (const layout of ['short_cta', 'newsletter']) {
      expect(
        EmailAiDraftRequestSchema.safeParse({ ...request, layout }).success,
      ).toBe(true)
    }
    expect(
      EmailAiDraftRequestSchema.safeParse({ ...request, layout: 'poster' })
        .success,
    ).toBe(false)
  })
})
