import { describe, expect, it } from 'vitest'
import {
  EMAIL_CONTENT_EXAMPLES,
  EMAIL_THEMES,
  EmailLayoutPresetKeySchema,
  type EmailContentDraft,
  type EmailThemeKey,
} from '@goodparty_org/contracts'
import { EMAIL_POSTAL_ADDRESS } from './emailTemplate.const'
import type { EmailTemplateContext } from './emailTemplate.types'
import { renderEmailTemplate } from './renderEmailTemplate'

const WIN: EmailTemplateContext = {
  senderName: 'Renee Wells',
  paidForBy: 'Wells for Mayor',
  sendDate: new Date(2026, 10, 3, 9, 0),
}
const SERVE: EmailTemplateContext = { ...WIN, paidForBy: null }

const LAYOUTS = EmailLayoutPresetKeySchema.options
const THEMES = Object.keys(EMAIL_THEMES) as EmailThemeKey[]

const letter = (
  overrides: Partial<EmailContentDraft> = {},
): EmailContentDraft => ({
  layout: 'personal_letter',
  theme: 'classic_blue',
  subject: 'Join us Saturday',
  blocks: [
    { type: 'paragraph', text: 'Hi {{first_name}} {{last_name}},' },
    { type: 'paragraph', text: 'We would love to see you.' },
  ],
  ...overrides,
})

describe('renderEmailTemplate', () => {
  it.each(LAYOUTS.flatMap((layout) => THEMES.map((theme) => [layout, theme])))(
    'renders the %s example in %s with variables, footer and dark-mode safeguards',
    async (layout, theme) => {
      const example = EMAIL_CONTENT_EXAMPLES[layout as 'short_cta'].win
      const colors = EMAIL_THEMES[theme as EmailThemeKey].colors
      const { html, text } = await renderEmailTemplate(
        { ...example, theme: theme as EmailThemeKey },
        WIN,
      )

      expect(html).toContain('{{first_name}}')
      expect(text).toContain('{{first_name}}')
      expect(html).toContain('{{unsubscribe_url}}')
      expect(html).toContain(EMAIL_POSTAL_ADDRESS)
      expect(text).toContain(EMAIL_POSTAL_ADDRESS)
      expect(html).toContain('Paid for by Wells for Mayor')
      expect(html).toContain('you asked to hear from Renee Wells')
      expect(html).toContain('name="color-scheme" content="light only"')
      expect(html).toContain(`bgcolor="${colors.card}"`)
      expect(html).toContain('prefers-color-scheme:dark')
      expect(html).toContain('src="https://app.goodparty.org/images/')
      expect(text).not.toMatch(/[-]/)
    },
  )

  describe('short_cta', () => {
    const example = EMAIL_CONTENT_EXAMPLES.short_cta.win
    const colors = EMAIL_THEMES.bold_red.colors

    it('puts the photo edge to edge, a big centered headline and the button on a theme-color band', async () => {
      const { html } = await renderEmailTemplate(example, WIN)
      expect(html).toMatch(/<img[^>]*style="[^"]*width:100%[^>]*width="600"/)
      expect(html).toMatch(
        /<h1[^>]*style="[^"]*font-size:36px[^"]*text-align:center[^"]*"[^>]*>Help me meet Maple Heights<\/h1>/,
      )
      expect(html).toMatch(
        new RegExp(
          `bgcolor="${colors.rule}" class="em-rule"[^>]*style="[^"]*padding:32px 24px[\\s\\S]*?bgcolor="${colors.accent}" class="em-accent"[\\s\\S]*?Save my spot`,
        ),
      )
      expect(html).not.toContain('class="em-header"')
    })

    it('centers the footer', async () => {
      const { html } = await renderEmailTemplate(example, WIN)
      expect(html).toMatch(
        /<p[^>]*class="em-meta"[^>]*text-align:center[^>]*>Paid for by/,
      )
    })
  })

  describe('long_update', () => {
    const example = EMAIL_CONTENT_EXAMPLES.long_update.serve
    const colors = EMAIL_THEMES.classic_blue.colors

    it('draws a theme-color masthead with the headline, the sender and the send date', async () => {
      const { html, text } = await renderEmailTemplate(example, SERVE)
      expect(html).toMatch(
        new RegExp(
          `bgcolor="${colors.header}" class="em-header"[\\s\\S]*?<h1[^>]*class="em-header-text"[^>]*>Your October update from Ward 2</h1>[\\s\\S]*?Renee Wells · November 3, 2026`,
        ),
      )
      expect(text).toContain('Your October update from Ward 2')
      expect(text).toContain('Renee Wells · November 3, 2026')
    })

    it('renders subheadings in the theme color, dividers and a smaller left button', async () => {
      const { html, text } = await renderEmailTemplate(example, SERVE)
      expect(html).toMatch(
        new RegExp(
          `<h2[^>]*class="em-subheading"[^>]*color:${colors.rule}[^>]*>A safer crossing at Pine and 5th</h2>`,
        ),
      )
      expect(html).toContain('class="em-divider"')
      expect(html).toMatch(
        /<a[^>]*class="em-cta-text"[^>]*font-size:15px[^>]*>Tell me what to work on next<\/a>/,
      )
      expect(text).toContain('A safer crossing at Pine and 5th')
      expect(text).toContain('https://example.org/riverton/ward-2-survey')
    })

    it('puts the photo full width right under the masthead', async () => {
      const { html } = await renderEmailTemplate(
        EMAIL_CONTENT_EXAMPLES.long_update.win,
        WIN,
      )
      expect(html.indexOf('class="em-header"')).toBeLessThan(
        html.indexOf('<img'),
      )
      expect(html.indexOf('<img')).toBeLessThan(
        html.indexOf('This month our volunteers'),
      )
      expect(html).toMatch(/<img[^>]*width="600"/)
    })
  })

  describe('personal_letter', () => {
    const example = EMAIL_CONTENT_EXAMPLES.personal_letter.win
    const colors = EMAIL_THEMES.cream_and_forest.colors

    it('has no header, a text-link button and a padded, centered photo', async () => {
      const { html, text } = await renderEmailTemplate(example, WIN)
      expect(html).not.toContain('class="em-header"')
      expect(html).not.toContain('class="em-rule"')
      expect(html).not.toContain('<h1')
      expect(html).not.toContain('class="em-cta"')
      expect(html).toMatch(
        new RegExp(
          `<a[^>]*class="em-cta-link"[^>]*color:${colors.cta}[^>]*text-decoration:underline[^>]*>See where I stand</a>`,
        ),
      )
      expect(html).toMatch(/<img[^>]*style="[^"]*width:78%[^>]*width="416"/)
      expect(html).not.toMatch(/<img[^>]*width="600"/)
      expect(text).toContain('https://example.org/sam-ortega/issues')
    })

    it('sits on a plain page instead of the theme tint', async () => {
      const { html } = await renderEmailTemplate(example, WIN)
      expect(html).toMatch(new RegExp(`<body[^>]*bgcolor="${colors.card}"`))
      expect(html).not.toContain(`bgcolor="${colors.bg}"`)
    })

    it('can end with the photo', async () => {
      const { html } = await renderEmailTemplate(
        letter({
          blocks: [
            { type: 'paragraph', text: 'Thank you,\nRenee' },
            {
              type: 'image',
              url: 'https://cdn.example.com/a.jpg',
              alt: 'Renee at the park',
            },
          ],
        }),
        WIN,
      )
      expect(html.indexOf('Renee<')).toBeLessThan(html.indexOf('<img'))
      expect(html).toContain('alt="Renee at the park"')
    })
  })

  it('shows Paid for by on Win and leaves it off on Serve', async () => {
    const win = await renderEmailTemplate(letter(), WIN)
    const serve = await renderEmailTemplate(letter(), SERVE)
    expect(win.html).toContain('Paid for by Wells for Mayor')
    expect(win.text).toContain('Paid for by Wells for Mayor')
    expect(serve.html).not.toContain('Paid for by')
    expect(serve.text).not.toContain('Paid for by')
    for (const { html } of [win, serve]) {
      expect(html).toContain(EMAIL_POSTAL_ADDRESS)
      expect(html).toContain('{{unsubscribe_url}}')
      expect(html).toContain('you asked to hear from Renee Wells')
    }
  })

  it('escapes html in user text and the footer', async () => {
    const { html } = await renderEmailTemplate(
      letter({
        subject: '5 < 6 & 7 > 3',
        blocks: [{ type: 'paragraph', text: 'a < b && c > d' }],
      }),
      { ...WIN, senderName: '<u>Renee</u>', paidForBy: '<s>Committee</s>' },
    )
    expect(html).not.toContain('<u>Renee</u>')
    expect(html).not.toContain('<s>Committee</s>')
    expect(html).toContain('a &lt; b &amp;&amp; c &gt; d')
  })

  it('rejects HTML and unknown merge tags in blocks', async () => {
    await expect(
      renderEmailTemplate(
        letter({ blocks: [{ type: 'paragraph', text: '<b>hi</b>' }] }),
        WIN,
      ),
    ).rejects.toThrow()
    await expect(
      renderEmailTemplate(
        letter({ blocks: [{ type: 'paragraph', text: 'Hi {{city}}' }] }),
        WIN,
      ),
    ).rejects.toThrow()
  })

  it('never lets a brace become a template variable', async () => {
    const typed = '{{{first_name}}} {x} \\{{first_name}}'
    const { html, text, subject } = await renderEmailTemplate(
      letter({
        subject: typed,
        blocks: [
          { type: 'paragraph', text: typed },
          {
            type: 'button',
            label: 'Go {now}',
            url: 'https://example.com/{{secret}}',
          },
        ],
      }),
      { ...WIN, senderName: '{{secret}}', paidForBy: '{{{x}}}' },
    )
    const variablesIn = (value: string) => [
      ...new Set(value.match(/\{\{\{?[^}]*\}?\}\}/g) ?? []),
    ]
    expect(variablesIn(html).sort()).toEqual([
      '{{first_name}}',
      '{{unsubscribe_url}}',
    ])
    expect(variablesIn(text).sort()).toEqual([
      '{{first_name}}',
      '{{unsubscribe_url}}',
    ])
    expect(html).not.toContain('{{{')
    expect(html).toContain('&#123;&#123;secret&#125;&#125;')
    expect(html).toContain('%7B%7Bsecret%7D%7D')
    expect(subject).not.toContain('{{{')
    expect(html).toContain('\\​{{first_name}}')
    expect(text).not.toContain('}}}')
    expect(text).toMatch(/\{\{first_name\}\}\u200B\}/)
  })

  it('keeps the merge tags in the subject', async () => {
    const { subject } = await renderEmailTemplate(
      letter({ subject: 'See you, {{first_name}}' }),
      WIN,
    )
    expect(subject).toBe('See you, {{first_name}}')
  })

  it('renders paragraphs and line breaks inside a paragraph block', async () => {
    const { html } = await renderEmailTemplate(
      letter({ blocks: [{ type: 'paragraph', text: 'One\nTwo\n\nThree' }] }),
      WIN,
    )
    expect(html.match(/<br\/?>/g)).toHaveLength(1)
    expect(html.match(/class="em-body"/g)).toHaveLength(2)
  })

  it('rejects links that are not https', async () => {
    await expect(
      renderEmailTemplate(
        letter({
          blocks: [
            { type: 'paragraph', text: 'Hi' },
            { type: 'button', label: 'Go', url: 'javascript:alert(1)' },
          ],
        }),
        WIN,
      ),
    ).rejects.toThrow()
  })

  it('leaves out the empty blocks of a draft', async () => {
    const { html } = await renderEmailTemplate(
      {
        layout: 'short_cta',
        theme: 'bold_red',
        subject: '',
        blocks: [
          { type: 'image', url: '', alt: '' },
          { type: 'heading', text: '', level: 1 },
          { type: 'paragraph', text: 'Only this' },
          { type: 'button', label: '', url: '' },
        ],
      },
      WIN,
    )
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<h1')
    expect(html).not.toContain('class="em-accent"')
    expect(html).toContain('Only this')
  })

  it('rejects a block the layout does not allow', async () => {
    await expect(
      renderEmailTemplate(
        letter({ blocks: [{ type: 'heading', text: 'Hi', level: 1 }] }),
        WIN,
      ),
    ).rejects.toThrow('doesn’t use heading blocks')
  })

  it('puts the preview text in the inbox preview but not the plain text', async () => {
    const { html, text } = await renderEmailTemplate(
      letter({ previewText: 'Coffee is on me' }),
      WIN,
    )
    expect(html).toContain('Coffee is on me')
    expect(text).not.toContain('Coffee is on me')
  })
})
