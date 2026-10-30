import { describe, expect, it } from 'vitest'
import {
  EmailContentSchema,
  type EmailContentView,
  type EmailLayoutPresetKey,
} from '@goodparty_org/contracts'
import {
  applyImprovedDraft,
  composeIssues,
  fillFromAiDraft,
  fromContent,
  initialCompose,
  messageToBlocks,
  serverFieldError,
  switchLayout,
  toContent,
  type EmailComposeState,
} from './emailForm.util'

const PHOTO = 'https://assets.example.com/email-images/org/a.png'

const form = (
  layout: EmailLayoutPresetKey,
  overrides: Partial<EmailComposeState> = {},
): EmailComposeState => ({
  ...switchLayout(initialCompose(), layout),
  subject: 'October',
  title: 'Ward 2 update',
  message: 'Dear neighbor,\n\nThank you,\nRenee',
  photoUrl: PHOTO,
  photoAlt: 'The new park',
  buttonLabel: 'Read more',
  buttonUrl: 'https://example.com',
  ...overrides,
})

const types = (state: EmailComposeState) =>
  toContent(state).blocks.map((block) =>
    block.type === 'heading' ? `h${block.level}` : block.type,
  )

describe('toContent', () => {
  it('puts the photo first and the button last in short_cta', () => {
    const state = form('short_cta')
    expect(types(state)).toEqual([
      'image',
      'h1',
      'paragraph',
      'paragraph',
      'button',
    ])
    expect(EmailContentSchema.safeParse(toContent(state)).success).toBe(true)
  })

  it('puts the photo under the masthead in long_update', () => {
    const state = form('long_update', {
      message: 'Dear neighbor,\n\n## The vote\nIt moved.\n\nThank you,\nRenee',
    })
    expect(toContent(state).blocks).toEqual([
      { type: 'heading', text: 'Ward 2 update', level: 1 },
      { type: 'image', url: PHOTO, alt: 'The new park' },
      { type: 'paragraph', text: 'Dear neighbor,' },
      { type: 'heading', text: 'The vote', level: 2 },
      { type: 'paragraph', text: 'It moved.' },
      { type: 'paragraph', text: 'Thank you,\nRenee' },
      { type: 'button', label: 'Read more', url: 'https://example.com' },
    ])
    expect(EmailContentSchema.safeParse(toContent(state)).success).toBe(true)
  })

  it('leaves the title out of personal_letter and places the photo as picked', () => {
    const top = form('personal_letter')
    expect(types(top)).toEqual(['image', 'paragraph', 'paragraph', 'button'])
    expect(EmailContentSchema.safeParse(toContent(top)).success).toBe(true)

    const bottom = form('personal_letter', { photoPosition: 'bottom' })
    expect(types(bottom)).toEqual(['paragraph', 'paragraph', 'button', 'image'])
    expect(EmailContentSchema.safeParse(toContent(bottom)).success).toBe(true)
  })

  it('leaves out an optional photo and button that are empty', () => {
    const state = form('personal_letter', {
      photoUrl: '',
      buttonLabel: '',
      buttonUrl: '',
    })
    expect(types(state)).toEqual(['paragraph', 'paragraph'])
  })

  it('keeps short_cta’s button even while it is empty', () => {
    expect(
      types(form('short_cta', { buttonLabel: '', buttonUrl: '' })).at(-1),
    ).toBe('button')
  })
})

describe('the ## rule', () => {
  const message = 'Hello\n\n## Roads\nWe paved Main St.'

  it('makes a subheading only in long_update', () => {
    expect(messageToBlocks(message, 'long_update')).toEqual([
      { type: 'paragraph', text: 'Hello' },
      { type: 'heading', text: 'Roads', level: 2 },
      { type: 'paragraph', text: 'We paved Main St.' },
    ])
  })

  it.each<EmailLayoutPresetKey>(['short_cta', 'personal_letter'])(
    'is plain text in %s, without the mark',
    (layout) => {
      expect(messageToBlocks(message, layout)).toEqual([
        { type: 'paragraph', text: 'Hello' },
        { type: 'paragraph', text: 'Roads\nWe paved Main St.' },
      ])
    },
  )

  it('splits paragraphs on a blank line, even one holding spaces', () => {
    expect(messageToBlocks('One\nline two\n  \nThree', 'long_update')).toEqual([
      { type: 'paragraph', text: 'One\nline two' },
      { type: 'paragraph', text: 'Three' },
    ])
  })
})

describe('fromContent', () => {
  it.each<[EmailLayoutPresetKey, Partial<EmailComposeState>]>([
    ['short_cta', {}],
    [
      'long_update',
      { message: 'Dear neighbor,\n\n## The vote\n\nIt moved.\n\nThank you' },
    ],
    ['personal_letter', { title: '', photoPosition: 'bottom' }],
    ['personal_letter', { title: '', photoPosition: 'top' }],
  ])('round-trips the form in %s', (layout, overrides) => {
    const state = form(layout, overrides)
    expect(fromContent(toContent(state))).toEqual(state)
  })

  it('maps blocks to fields and drops dividers', () => {
    const content: EmailContentView = {
      layout: 'long_update',
      theme: 'classic_blue',
      subject: 'October',
      blocks: [
        { type: 'heading', text: 'Ward 2 update', level: 1 },
        { type: 'image', url: PHOTO, alt: 'Park' },
        { type: 'paragraph', text: 'Dear neighbor,' },
        { type: 'divider' },
        { type: 'heading', text: 'The vote', level: 2 },
        { type: 'paragraph', text: 'It moved.' },
        { type: 'button', label: 'Read', url: '' },
      ],
    }
    expect(fromContent(content)).toMatchObject({
      title: 'Ward 2 update',
      message: 'Dear neighbor,\n\n## The vote\n\nIt moved.',
      photoUrl: PHOTO,
      photoAlt: 'Park',
      photoPosition: 'top',
      buttonLabel: 'Read',
      buttonUrl: '',
    })
  })

  it('reads a personal letter’s last-block photo as Bottom', () => {
    expect(
      fromContent({
        layout: 'personal_letter',
        theme: 'cream_and_forest',
        subject: 'Hi',
        blocks: [
          { type: 'paragraph', text: 'Hi' },
          { type: 'image', url: PHOTO, alt: 'Me' },
        ],
      }).photoPosition,
    ).toBe('bottom')
  })
})

describe('switchLayout', () => {
  it('keeps every value and hides the ones the layout doesn’t use', () => {
    const state = form('long_update', {
      message: 'Hi\n\n## Roads\n\nPaved.',
    })
    const letter = switchLayout(state, 'personal_letter')
    expect(letter).toMatchObject({
      title: 'Ward 2 update',
      message: 'Hi\n\n## Roads\n\nPaved.',
      photoUrl: PHOTO,
      buttonLabel: 'Read more',
    })
    expect(types(letter)).not.toContain('h1')
    expect(switchLayout(letter, 'long_update').title).toBe('Ward 2 update')
  })

  it('follows the layout’s theme unless the user picked one', () => {
    expect(switchLayout(initialCompose(), 'short_cta').theme).toBe('bold_red')
    expect(
      switchLayout({ ...initialCompose(), theme: 'classic_blue' }, 'short_cta')
        .theme,
    ).toBe('classic_blue')
  })
})

describe('composeIssues', () => {
  it('names the field, not the block', () => {
    expect(
      composeIssues(
        form('short_cta', {
          title: '',
          photoAlt: '',
          buttonUrl: '',
        }),
        true,
      ),
    ).toEqual({
      title: 'Add a title.',
      photo: 'Describe the photo for people who can’t see it.',
      button: 'Add the link this button opens.',
    })
  })

  it('says a message too long for short_cta in the form’s terms', () => {
    expect(
      composeIssues(form('short_cta', { message: 'a'.repeat(601) }), false)
        .message,
    ).toBe('Keep the message under 600 characters for this layout.')
  })

  it('asks for 2 paragraphs in a long update only on Next', () => {
    const state = form('long_update', { message: 'Just one.' })
    expect(composeIssues(state, false)).toEqual({})
    expect(composeIssues(state, true).message).toBe(
      'Write at least 2 paragraphs, with a blank line between them.',
    )
  })

  it('says too many paragraphs for short_cta on the message', () => {
    expect(
      composeIssues(form('short_cta', { message: 'a\n\nb\n\nc' }), false)
        .message,
    ).toBe('Use 1 or 2 paragraphs for this layout, or switch to Long update.')
  })

  it('asks for the subject, title and message of an empty form', () => {
    expect(
      composeIssues({ ...initialCompose(), layout: 'long_update' }, true),
    ).toMatchObject({
      subject: 'Add a subject line.',
      title: 'Add a title.',
      message: 'Write at least 2 paragraphs, with a blank line between them.',
    })
  })
})

describe('serverFieldError', () => {
  it('maps the server’s "Block N" to the field it came from', () => {
    const state = form('long_update')
    expect(
      serverFieldError(
        state,
        'Finish the email before sending it. Block 2: Links must start with https://',
      ),
    ).toEqual({ field: 'photo', message: 'Upload the photo again.' })
    expect(
      serverFieldError(state, 'Block 1: Keep this to one line')?.field,
    ).toBe('title')
    expect(serverFieldError(state, 'Block 3: Nope')?.field).toBe('message')
    expect(serverFieldError(state, 'Block 5: Nope')?.field).toBe('button')
  })

  it('uses the form’s own words when it finds the same problem', () => {
    expect(
      serverFieldError(
        form('short_cta', { buttonUrl: '' }),
        'Block 5: Links must start with https://',
      ),
    ).toEqual({ field: 'button', message: 'Add the link this button opens.' })
  })

  it('is null for an error that names no block', () => {
    expect(serverFieldError(form('short_cta'), 'Something broke')).toBeNull()
  })
})

describe('AI drafts', () => {
  const content: EmailContentView = {
    layout: 'short_cta',
    theme: 'bold_red',
    subject: 'Knock doors',
    blocks: [
      { type: 'heading', text: 'Join us Saturday', level: 1 },
      { type: 'paragraph', text: 'Two hours.' },
      { type: 'button', label: 'Sign up', url: '' },
    ],
  }

  it('fills the form, keeping an uploaded photo and a typed link', () => {
    const next = fillFromAiDraft(
      {
        ...switchLayout(initialCompose(), 'short_cta'),
        photoUrl: PHOTO,
        buttonUrl: 'https://example.com',
      },
      content,
    )
    expect(next).toMatchObject({
      layout: 'short_cta',
      subject: 'Knock doors',
      title: 'Join us Saturday',
      message: 'Two hours.',
      photoUrl: PHOTO,
      buttonLabel: 'Sign up',
      buttonUrl: 'https://example.com',
    })
    expect(next.pristine).toBeDefined()
  })

  it('keeps a short_cta draft to 2 paragraphs when its text has blank lines', () => {
    const next = fillFromAiDraft(switchLayout(initialCompose(), 'short_cta'), {
      ...content,
      blocks: [
        { type: 'heading', text: 'Join us', level: 1 },
        {
          type: 'paragraph',
          text: 'Hi {{first_name}},\n\nTwo hours.\n\nSee you.',
        },
        { type: 'button', label: 'Sign up', url: '' },
      ],
    })
    expect(next.message).toBe('Hi {{first_name}},\n\nTwo hours.\nSee you.')
    expect(composeIssues(next, false)).toEqual({})
  })

  it('puts Improve’s reply back into the fields', () => {
    expect(
      applyImprovedDraft(form('short_cta'), {
        subject: 'Better',
        headline: 'Sharper',
        body: 'New text.',
        buttonLabel: 'Go',
      }),
    ).toMatchObject({
      subject: 'Better',
      title: 'Sharper',
      message: 'New text.',
      buttonLabel: 'Go',
    })
  })

  it('takes no suggested button label where there is no button', () => {
    expect(
      applyImprovedDraft(form('personal_letter', { buttonLabel: '' }), {
        subject: 'Better',
        headline: null,
        body: 'New text.',
        buttonLabel: 'Go',
      }).buttonLabel,
    ).toBe('')
  })
})
