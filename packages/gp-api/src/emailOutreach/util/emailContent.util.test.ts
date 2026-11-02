import { BadRequestException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { EmailContentSchema } from '@goodparty_org/contracts'
import {
  emailContentOf,
  fieldsContent,
  fieldsToBlocks,
  sendableContentOf,
} from './emailContent.util'

const fields = (overrides: object = {}) => ({
  layout: 'newsletter',
  theme: 'classic_blue',
  subject: 'Town hall on Thursday',
  headline: 'Come to the town hall',
  body: 'Hi {{first_name}},\n\nWe meet at 7pm.',
  imageUrl: null,
  buttonLabel: null,
  buttonUrl: null,
  ...overrides,
})

describe('fieldsContent (drafts saved with the old fields)', () => {
  it('maps a newsletter to a long update: masthead, then paragraphs', () => {
    const content = fieldsContent(
      fields({
        imageUrl: 'https://cdn.example.com/a.jpg',
        buttonLabel: 'RSVP',
        buttonUrl: 'https://example.com/rsvp',
      }),
    )
    expect(content).toEqual({
      layout: 'long_update',
      theme: 'classic_blue',
      subject: 'Town hall on Thursday',
      blocks: [
        { type: 'heading', text: 'Come to the town hall', level: 1 },
        { type: 'image', url: 'https://cdn.example.com/a.jpg', alt: '' },
        { type: 'paragraph', text: 'Hi {{first_name}},' },
        { type: 'paragraph', text: 'We meet at 7pm.' },
        { type: 'button', label: 'RSVP', url: 'https://example.com/rsvp' },
      ],
    })
    expect(EmailContentSchema.safeParse(content).success).toBe(true)
  })

  it('maps a call to action to a short email with the button last', () => {
    const content = fieldsContent(
      fields({
        layout: 'call_to_action',
        buttonLabel: 'RSVP',
        buttonUrl: 'https://example.com/rsvp',
      }),
    )
    expect(content.layout).toBe('short_cta')
    expect(content.blocks.map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'button',
    ])
    expect(EmailContentSchema.safeParse(content).success).toBe(true)
  })

  it('falls back to a personal letter, headline first, when the old layout does not fit', () => {
    const content = fieldsContent(fields({ body: 'Join us at 7pm.' }))
    expect(content).toMatchObject({
      layout: 'personal_letter',
      blocks: [
        { type: 'paragraph', text: 'Come to the town hall' },
        { type: 'paragraph', text: 'Join us at 7pm.' },
      ],
    })
    expect(EmailContentSchema.safeParse(content).success).toBe(true)
  })

  it('turns a headline too long for a heading into the opening paragraph', () => {
    const headline = 'a'.repeat(130)
    const content = fieldsContent(fields({ headline }))
    expect(content.layout).toBe('personal_letter')
    expect(content.blocks[0]).toEqual({ type: 'paragraph', text: headline })
    expect(EmailContentSchema.safeParse(content).success).toBe(true)
  })

  it('reads a block draft from its content column instead', () => {
    const blocks = [{ type: 'paragraph', text: 'From the column' }]
    expect(
      emailContentOf({
        ...fields(),
        content: {
          layout: 'personal_letter',
          theme: 'fresh_green',
          subject: 'Hi',
          blocks,
        },
      }),
    ).toEqual({
      layout: 'personal_letter',
      theme: 'fresh_green',
      subject: 'Hi',
      blocks,
    })
  })
})

describe('fieldsToBlocks (the AI draft)', () => {
  it('leaves the button link empty for the author', () => {
    expect(
      fieldsToBlocks('short_cta', {
        headline: 'Join us',
        body: 'One\n\nTwo',
        imageUrl: null,
        buttonLabel: 'RSVP',
        buttonUrl: null,
      }),
    ).toEqual([
      { type: 'heading', text: 'Join us', level: 1 },
      { type: 'paragraph', text: 'One\n\nTwo' },
      { type: 'button', label: 'RSVP', url: '' },
    ])
  })
})

describe('sendableContentOf', () => {
  it('refuses a block draft that is not finished, naming the block', () => {
    expect(() =>
      sendableContentOf({
        ...fields(),
        content: {
          layout: 'short_cta',
          theme: 'bold_red',
          subject: 'Hi',
          blocks: [
            { type: 'heading', text: 'Join us', level: 1 },
            { type: 'paragraph', text: 'Saturday at 10.' },
            { type: 'button', label: 'RSVP', url: '' },
          ],
        },
      }),
    ).toThrow(
      new BadRequestException(
        'Finish the email before sending it. Block 3: Links must start with https://',
      ),
    )
  })
})
