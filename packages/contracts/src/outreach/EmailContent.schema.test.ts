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
      for (const type of preset.usualBlocks) {
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
    expect(schema).toContain(
      'only when the goal has a clear online action such as signing up',
    )
    expect(schema).not.toContain('Exactly one button')
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

describe('shared rules', () => {
  const result = (layout: EmailLayoutPresetKey, blocks: unknown[]) =>
    messages(EmailContentSchema.safeParse(withBlocks(layout, blocks)))

  const heading = (level: 1 | 2) => ({ type: 'heading', text: 'Hi', level })

  // Each of these broke one layout's old structure rules.
  const shapes: Record<string, unknown[]> = {
    'no button': [masthead, paragraph('Short and to the point.')],
    'a button first': [button, paragraph('Hi')],
    'a photo in the middle': [paragraph('A'), photo, paragraph('B')],
    'a photo last': [masthead, paragraph('A'), photo],
    'no heading': [paragraph('A')],
    'headings at any level, anywhere': [
      paragraph('A'),
      heading(2),
      paragraph('B'),
      heading(1),
      heading(1),
      paragraph('C'),
    ],
    dividers: [paragraph('A'), { type: 'divider' }, paragraph('B')],
    'many long paragraphs': Array.from({ length: 5 }, () =>
      paragraph('a'.repeat(900)),
    ),
  }

  it.each(
    LAYOUTS.flatMap((layout) =>
      Object.keys(shapes).map((shape) => [layout, shape] as const),
    ),
  )('%s accepts %s', (layout, shape) => {
    expect(result(layout, shapes[shape]!)).toEqual([])
  })

  it.each(LAYOUTS)('%s takes at most one photo and one button', (layout) => {
    expect(result(layout, [photo, paragraph('A'), photo])).toContain(
      'Use at most one photo',
    )
    expect(result(layout, [paragraph('A'), button, button])).toContain(
      'Use at most one button',
    )
  })

  it.each(LAYOUTS)('%s needs a paragraph to send', (layout) => {
    expect(result(layout, [masthead, button])).toContain('Add a paragraph')
  })

  it('does not crash on a malformed block', () => {
    expect(
      EmailContentSchema.safeParse(
        withBlocks('short_cta', [
          masthead,
          { type: 'button' },
          paragraph('Hi'),
        ]),
      ).success,
    ).toBe(false)
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

  it('does not need alt text on an image', () => {
    const parsed = parseBlock({
      type: 'image',
      url: 'https://example.org/a.png',
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data).toMatchObject({ alt: '' })
    expect(
      parseBlock({ type: 'image', url: 'https://example.org/a.png', alt: '' })
        .success,
    ).toBe(true)
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

describe('draft rules', () => {
  const draft = (layout: EmailLayoutPresetKey, blocks: unknown[]) =>
    EmailContentDraftSchema.safeParse({
      layout,
      theme: 'classic_blue',
      subject: '',
      blocks,
    })

  it('saves a draft that is still missing its paragraph', () => {
    expect(messages(draft('short_cta', []))).toEqual([])
    expect(
      messages(draft('short_cta', [{ type: 'heading', text: '', level: 1 }])),
    ).toEqual([])
    expect(messages(draft('personal_letter', [masthead, button]))).toEqual([])
    expect(
      messages(draft('long_update', [masthead, subheading(''), paragraph('')])),
    ).toEqual([])
  })

  it('still rejects a second photo or button', () => {
    expect(messages(draft('personal_letter', [photo, photo]))).toContain(
      'Use at most one photo',
    )
    expect(messages(draft('short_cta', [button, button]))).toContain(
      'Use at most one button',
    )
  })
})
