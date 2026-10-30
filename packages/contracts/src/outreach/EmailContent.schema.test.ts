import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  EMAIL_BLOCK_TYPES,
  EMAIL_CONTENT_TEXT_MAX_LENGTH,
  EMAIL_HEADING_MAX_LENGTH,
  EMAIL_MAX_BLOCKS,
  EMAIL_PARAGRAPH_MAX_LENGTH,
  EmailBlockSchema,
  type EmailBlock,
} from './EmailBlock.schema'
import { EMAIL_CONTENT_EXAMPLES } from './EmailContent.examples'
import {
  EmailContentDraftSchema,
  EmailContentSchema,
  type EmailContent,
} from './EmailContent.schema'
import {
  EMAIL_LAYOUT_PRESETS,
  EmailLayoutPresetKeySchema,
  type EmailLayoutPresetKey,
} from './EmailLayoutPreset.const'
import { EMAIL_THEMES } from './EmailTemplate.const'

const LAYOUTS = EmailLayoutPresetKeySchema.options

const messages = (result: { success: boolean; error?: z.ZodError }) =>
  result.error?.issues.map((issue) => issue.message) ?? []

const withBlocks = (
  layout: EmailLayoutPresetKey,
  blocks: unknown[],
): Record<string, unknown> => ({
  ...EMAIL_CONTENT_EXAMPLES[layout].win,
  blocks,
})

const paragraph = (text: string) => ({ type: 'paragraph', text })
const masthead = { type: 'heading', text: 'Update', level: 1 }
const subheading = (text: string) => ({ type: 'heading', text, level: 2 })
const photo = {
  type: 'image',
  url: 'https://example.org/a.png',
  alt: 'A park',
}
const button = {
  type: 'button',
  label: 'RSVP now',
  url: 'https://example.org/rsvp',
}

describe('layout presets', () => {
  it('keeps the key schema in step with the registry', () => {
    expect([...LAYOUTS].sort()).toEqual(
      Object.keys(EMAIL_LAYOUT_PRESETS).sort(),
    )
  })

  it.each(LAYOUTS)(
    '%s has a real default theme and known block types',
    (key) => {
      const preset = EMAIL_LAYOUT_PRESETS[key]
      expect(EMAIL_THEMES).toHaveProperty(preset.defaultTheme)
      for (const type of preset.allowedBlocks) {
        expect(EMAIL_BLOCK_TYPES).toContain(type)
      }
    },
  )

  it.each(LAYOUTS)('%s starter blocks pass the draft schema', (key) => {
    const preset = EMAIL_LAYOUT_PRESETS[key]
    const result = EmailContentDraftSchema.safeParse({
      layout: key,
      theme: preset.defaultTheme,
      subject: '',
      blocks: preset.starterBlocks,
    })
    expect(messages(result)).toEqual([])
  })

  it.each(LAYOUTS)('%s starter blocks cannot be sent while empty', (key) => {
    const preset = EMAIL_LAYOUT_PRESETS[key]
    const result = EmailContentSchema.safeParse({
      layout: key,
      theme: preset.defaultTheme,
      subject: 'Hello',
      blocks: preset.starterBlocks,
    })
    expect(result.success).toBe(false)
  })
})

describe('examples', () => {
  it.each(
    LAYOUTS.flatMap((layout) => [
      [layout, 'win'] as const,
      [layout, 'serve'] as const,
    ]),
  )('%s %s example validates', (layout, mode) => {
    const example = EMAIL_CONTENT_EXAMPLES[layout][mode]
    expect(example.layout).toBe(layout)
    expect(messages(EmailContentSchema.safeParse(example))).toEqual([])
  })

  it('keeps Win nouns out of Serve examples', () => {
    for (const layout of LAYOUTS) {
      const text = JSON.stringify(EMAIL_CONTENT_EXAMPLES[layout].serve)
      expect(text).not.toMatch(
        /\b(voters?|election|candidate|ballot|campaign)\b/i,
      )
    }
  })
})

// What a model returns: a JSON string, parsed as-is, never typed.
const AGENT_DRAFTS: Record<EmailLayoutPresetKey, string> = {
  short_cta: `{
    "layout": "short_cta",
    "theme": "fresh_green",
    "subject": "Can you give 10 minutes to our park survey?",
    "previewText": "Your answers shape next year's parks budget.",
    "blocks": [
      { "type": "heading", "level": 1, "text": "What should our parks fix first?" },
      { "type": "paragraph", "text": "Hi {{first_name}}, the parks department is setting next year's priorities. Tell me which repairs matter most to your family." },
      { "type": "button", "label": "Take the survey", "url": "https://example.org/parks-survey" }
    ]
  }`,
  long_update: `{
    "layout": "long_update",
    "theme": "classic_blue",
    "subject": "Progress on the three issues you raised",
    "blocks": [
      { "type": "heading", "level": 1, "text": "Your September update" },
      { "type": "paragraph", "text": "Hi {{first_name}}, here's where things stand on the issues you told me matter most." },
      { "type": "heading", "level": 2, "text": "Potholes on River Road" },
      { "type": "paragraph", "text": "Crews filled 38 potholes in two weeks. The full repave is scheduled for April, once the ground thaws." },
      { "type": "heading", "level": 2, "text": "Late-night noise downtown" },
      { "type": "paragraph", "text": "The council will hear a draft noise ordinance on October 8. It sets quiet hours after 11pm on weeknights." },
      { "type": "divider" },
      { "type": "paragraph", "text": "The senior center now stays open until 7pm on weekdays." },
      { "type": "paragraph", "text": "Thank you,\\nDana Whitfield\\nCity Council Member, Ward 2" }
    ]
  }`,
  personal_letter: `{
    "layout": "personal_letter",
    "theme": "cream_and_forest",
    "subject": "Thank you, {{first_name}}",
    "blocks": [
      { "type": "paragraph", "text": "Dear {{first_name}},\\n\\nThank you for coming to Thursday's meeting. Forty neighbors showed up, and the board heard every one of you." },
      { "type": "paragraph", "text": "I'll write again once the board decides. Until then, just reply if you have questions." },
      { "type": "paragraph", "text": "Thank you,\\nPriya Natarajan\\nTownship Trustee" }
    ]
  }`,
}

describe('agent drafts', () => {
  it.each(LAYOUTS)('a %s draft from JSON validates', (layout) => {
    const result = EmailContentSchema.safeParse(
      JSON.parse(AGENT_DRAFTS[layout]),
    )
    expect(messages(result)).toEqual([])
  })

  it('converts to JSON Schema for a model, with descriptions', () => {
    const schema = JSON.stringify(
      z.toJSONSchema(EmailContentSchema, { io: 'input' }),
    )
    expect(schema).toContain('"description"')
    expect(schema).toContain('Never invent or guess an image URL')
    expect(schema).toContain('{{first_name}}')
    expect(schema).toContain('Exactly one button, and it is the last block.')
  })

  it('rejects a block type that does not exist', () => {
    const draft = JSON.parse(AGENT_DRAFTS.short_cta)
    draft.blocks.splice(1, 0, { type: 'html', html: '<b>hi</b>' })
    expect(EmailContentSchema.safeParse(draft).success).toBe(false)
  })

  it('rejects a field a block does not take', () => {
    const draft = JSON.parse(AGENT_DRAFTS.short_cta)
    draft.blocks[0].color = 'red'
    expect(EmailContentSchema.safeParse(draft).success).toBe(false)
  })

  it('rejects a footer the system owns', () => {
    const draft = JSON.parse(AGENT_DRAFTS.short_cta)
    draft.footer = 'Paid for by me'
    expect(EmailContentSchema.safeParse(draft).success).toBe(false)
  })
})

describe('layout rules', () => {
  const rejects = (
    layout: EmailLayoutPresetKey,
    blocks: unknown[],
    message: string,
  ) => {
    const result = EmailContentSchema.safeParse(withBlocks(layout, blocks))
    expect(messages(result)).toContain(message)
  }

  const cta = (overrides: { before?: unknown[]; after?: unknown[] } = {}) => [
    ...(overrides.before ?? []),
    { type: 'heading', text: 'Join us', level: 1 },
    paragraph('Short and to the point.'),
    ...(overrides.after ?? []),
  ]

  it('short_cta needs exactly one button, last', () => {
    rejects('short_cta', cta(), 'Add a button')
    rejects(
      'short_cta',
      cta({ after: [button, button] }),
      'Use exactly one button',
    )
    rejects(
      'short_cta',
      [{ type: 'heading', text: 'Join us', level: 1 }, button, paragraph('Hi')],
      'The button goes last',
    )
  })

  it('short_cta puts the photo first and allows no dividers', () => {
    rejects(
      'short_cta',
      [
        { type: 'heading', text: 'Join us', level: 1 },
        photo,
        paragraph('Hi'),
        button,
      ],
      'The photo goes first',
    )
    rejects(
      'short_cta',
      cta({ after: [{ type: 'divider' }, button] }),
      'The Short with a button layout doesn’t use divider blocks',
    )
  })

  it('short_cta keeps the text short', () => {
    rejects(
      'short_cta',
      [
        { type: 'heading', text: 'Join us', level: 1 },
        paragraph('a'.repeat(400)),
        paragraph('b'.repeat(400)),
        button,
      ],
      'Keep the text to 600 characters, or use a long update',
    )
  })

  it('long_update needs at least 2 paragraphs', () => {
    rejects(
      'long_update',
      [masthead, paragraph('Only one')],
      'Add at least 2 paragraphs',
    )
  })

  it('long_update starts with a masthead', () => {
    rejects(
      'long_update',
      [paragraph('One'), paragraph('Two')],
      'Start with a level 1 heading',
    )
    rejects(
      'long_update',
      [paragraph('One'), masthead, paragraph('Two')],
      'Start with a level 1 heading',
    )
  })

  it('long_update allows one photo, right after the masthead', () => {
    expect(
      messages(
        EmailContentSchema.safeParse(
          withBlocks('long_update', [
            masthead,
            photo,
            paragraph('A'),
            paragraph('B'),
          ]),
        ),
      ),
    ).toEqual([])
    rejects(
      'long_update',
      [masthead, paragraph('A'), photo, paragraph('B')],
      'The photo goes right after the headline',
    )
    rejects(
      'long_update',
      [masthead, photo, paragraph('A'), photo, paragraph('B')],
      'Use at most one photo',
    )
  })

  it('personal_letter has no headings', () => {
    rejects(
      'personal_letter',
      [{ type: 'heading', text: 'Hi', level: 1 }, paragraph('Dear neighbor')],
      'The Personal letter layout doesn’t use heading blocks',
    )
  })

  it('personal_letter puts one photo at the very top or the very end', () => {
    const accepts = (blocks: unknown[]) =>
      expect(
        messages(
          EmailContentSchema.safeParse(withBlocks('personal_letter', blocks)),
        ),
      ).toEqual([])
    accepts([photo, paragraph('Dear neighbor'), paragraph('Thanks')])
    accepts([paragraph('Dear neighbor'), paragraph('Thanks'), photo])
    accepts([paragraph('Dear neighbor'), button, photo])
    rejects(
      'personal_letter',
      [paragraph('Dear neighbor'), photo, paragraph('Thanks')],
      'Put the photo at the very top or the very end',
    )
    rejects(
      'personal_letter',
      [photo, paragraph('Dear neighbor'), paragraph('Thanks'), photo],
      'Use at most one photo',
    )
    rejects(
      'personal_letter',
      [photo, button, paragraph('Dear neighbor')],
      'Start with a paragraph',
    )
  })

  it('personal_letter is only paragraphs and one button', () => {
    rejects(
      'personal_letter',
      [paragraph('Dear neighbor'), button, paragraph('Thanks'), button],
      'Use at most one button',
    )
    rejects(
      'personal_letter',
      [paragraph('Dear neighbor'), { type: 'divider' }, paragraph('Thanks')],
      'The Personal letter layout doesn’t use divider blocks',
    )
  })
})

describe('field rules', () => {
  const parseBlock = (block: unknown) => EmailBlockSchema.safeParse(block)

  it('enforces length limits', () => {
    expect(
      parseBlock({
        type: 'heading',
        text: 'a'.repeat(EMAIL_HEADING_MAX_LENGTH),
        level: 1,
      }).success,
    ).toBe(true)
    expect(
      parseBlock({
        type: 'heading',
        text: 'a'.repeat(EMAIL_HEADING_MAX_LENGTH + 1),
        level: 1,
      }).success,
    ).toBe(false)
    expect(
      parseBlock(paragraph('a'.repeat(EMAIL_PARAGRAPH_MAX_LENGTH + 1))).success,
    ).toBe(false)
    expect(parseBlock({ ...button, label: 'a'.repeat(41) }).success).toBe(false)
  })

  it('caps blocks per email', () => {
    const blocks = [
      masthead,
      paragraph('A'),
      paragraph('B'),
      ...Array.from({ length: EMAIL_MAX_BLOCKS - 2 }, () => ({
        type: 'divider',
      })),
    ]
    const result = EmailContentSchema.safeParse(
      withBlocks('long_update', blocks),
    )
    expect(
      result.error?.issues.some(
        (issue) =>
          issue.code === 'too_big' && issue.path.join('.') === 'blocks',
      ),
    ).toBe(true)
  })

  it('caps the text of the whole email', () => {
    const blocks: EmailBlock[] = [
      { type: 'heading', text: 'Update', level: 1 },
      ...Array.from(
        {
          length:
            Math.ceil(
              EMAIL_CONTENT_TEXT_MAX_LENGTH / EMAIL_PARAGRAPH_MAX_LENGTH,
            ) + 1,
        },
        () => paragraph('a'.repeat(EMAIL_PARAGRAPH_MAX_LENGTH)) as EmailBlock,
      ),
    ]
    const content: EmailContent = {
      ...EMAIL_CONTENT_EXAMPLES.long_update.win,
      blocks,
    }
    expect(messages(EmailContentSchema.safeParse(content))).toContain(
      `Keep the whole email under ${EMAIL_CONTENT_TEXT_MAX_LENGTH.toLocaleString('en-US')} characters`,
    )
  })

  it.each([
    'http://example.org/rsvp',
    'javascript:alert(1)',
    'mailto:me@example.org',
    'example.org/rsvp',
  ])('rejects the non-https link %s', (url) => {
    expect(parseBlock({ ...button, url }).success).toBe(false)
    expect(parseBlock({ type: 'image', url, alt: 'A park' }).success).toBe(
      false,
    )
  })

  it('allows only the two merge tags', () => {
    expect(
      parseBlock(paragraph('Hi {{first_name}} {{last_name}}')).success,
    ).toBe(true)
    expect(parseBlock(paragraph('Hi {{city}}')).success).toBe(false)
    expect(parseBlock(paragraph('Hi {{ first_name }}')).success).toBe(false)
    expect(parseBlock(paragraph('Hi {first_name}')).success).toBe(true)
  })

  it('rejects HTML and line breaks where they do not belong', () => {
    expect(parseBlock(paragraph('<b>Vote</b> for me')).success).toBe(false)
    expect(parseBlock(paragraph('Turnout was 3 < 5 last time')).success).toBe(
      true,
    )
    expect(
      parseBlock({ type: 'heading', text: 'One\nTwo', level: 1 }).success,
    ).toBe(false)
  })

  it('needs alt text on every image', () => {
    expect(
      parseBlock({ type: 'image', url: 'https://example.org/a.png', alt: '' })
        .success,
    ).toBe(false)
    expect(
      parseBlock({ type: 'image', url: 'https://example.org/a.png' }).success,
    ).toBe(false)
  })

  it('reads a lone < as text and a tag as HTML', () => {
    expect(
      parseBlock(paragraph('Kids <3 the splash pad, ages 3-5 > 40 of them'))
        .success,
    ).toBe(true)
    expect(parseBlock(paragraph('<a href="https://x.org">x</a>')).success).toBe(
      false,
    )
    expect(parseBlock(paragraph('Hi <!-- note -->')).success).toBe(false)
  })

  it('treats Unicode line separators as line breaks', () => {
    expect(
      parseBlock({ type: 'heading', text: 'One\u2028Two', level: 1 }).success,
    ).toBe(false)
  })
})

describe('more layout rules', () => {
  const rejects = (
    layout: EmailLayoutPresetKey,
    blocks: unknown[],
    message: string,
  ) => {
    const result = EmailContentSchema.safeParse(withBlocks(layout, blocks))
    expect(messages(result)).toContain(message)
  }

  it('checks heading levels', () => {
    rejects(
      'short_cta',
      [{ type: 'heading', text: 'Join us', level: 2 }, paragraph('Hi'), button],
      'The headline is level 1',
    )
    rejects(
      'long_update',
      [
        masthead,
        paragraph('A'),
        { type: 'heading', text: 'Also', level: 1 },
        paragraph('B'),
      ],
      'Only the first heading is level 1',
    )
  })

  it('starts a personal_letter with a paragraph', () => {
    rejects(
      'personal_letter',
      [button, paragraph('Hi')],
      'Start with a paragraph',
    )
  })

  it('does not crash on a malformed block', () => {
    const result = EmailContentSchema.safeParse(
      withBlocks('short_cta', [
        { type: 'heading', text: 'Join us', level: 1 },
        { type: 'button' },
        paragraph('Hi'),
        button,
      ]),
    )
    expect(result.success).toBe(false)
  })
})

describe('draft rules', () => {
  const draft = (layout: EmailLayoutPresetKey, blocks: unknown[]) =>
    EmailContentDraftSchema.safeParse({
      layout,
      theme: 'classic_blue',
      subject: '',
      blocks,
    })

  it('saves a draft that is still missing a required block', () => {
    expect(messages(draft('short_cta', []))).toEqual([])
    expect(
      messages(draft('short_cta', [{ type: 'heading', text: '', level: 1 }])),
    ).toEqual([])
    expect(messages(draft('personal_letter', []))).toEqual([])
    expect(
      messages(draft('long_update', [masthead, subheading(''), paragraph('')])),
    ).toEqual([])
  })

  it('still rejects a block the layout does not use, or the wrong order', () => {
    expect(
      messages(draft('personal_letter', [paragraph(''), { type: 'divider' }])),
    ).toContain('The Personal letter layout doesn’t use divider blocks')
    expect(
      messages(draft('personal_letter', [button, paragraph('')])),
    ).toContain('Start with a paragraph')
  })
})
