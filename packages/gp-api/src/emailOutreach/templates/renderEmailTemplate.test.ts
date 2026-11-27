import { describe, expect, it } from 'vitest'
import {
  EMAIL_CLASSIC_LAYOUT_PRESETS,
  EMAIL_CONTENT_EXAMPLES,
  EMAIL_LETTER_THEMES,
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
  sendDate: new Date('2026-11-03T17:00:00Z'),
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

  it.each(LAYOUTS)('narrows the %s gutters on a phone', async (layout) => {
    const { html } = await renderEmailTemplate(
      EMAIL_CONTENT_EXAMPLES[layout].win,
      WIN,
    )
    expect(html).toContain(
      '@media only screen and (max-width:620px){.em-pad{padding-left:20px !important;padding-right:20px !important}.em-page{padding-left:0 !important;padding-right:0 !important}}',
    )
    expect(html).toMatch(
      /<td[^>]*class="em-(bg|card) em-page"[^>]*padding:24px 12px/,
    )
    expect(html).toMatch(
      /<td[^>]*class="em-card em-pad"[^>]*padding:24px 32px 32px/,
    )
    expect(html).not.toMatch(/class="[^"]*em-pad[^"]*"[^>]*height="1"/)
  })

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
          `bgcolor="${colors.rule}" class="em-band em-pad"[^>]*style="[^"]*padding:32px 24px[\\s\\S]*?bgcolor="${colors.accent}" class="em-accent"[\\s\\S]*?Save my spot`,
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

    it('dates the masthead by the Pacific day, not the UTC one', async () => {
      // 8:30pm on November 3 in Los Angeles is already November 4 in UTC.
      const { text } = await renderEmailTemplate(example, {
        ...SERVE,
        sendDate: new Date('2026-11-04T04:30:00Z'),
      })
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

    it('keeps text after the button below it, not beside it', async () => {
      const { html } = await renderEmailTemplate(
        EMAIL_CONTENT_EXAMPLES.long_update.win,
        WIN,
      )
      const button = html.indexOf('Read my full water plan')
      const tableStart = html.lastIndexOf('<table', button)
      expect(html.slice(tableStart, button)).not.toContain('align="left"')
      expect(button).toBeLessThan(html.indexOf('Thank you,'))
    })
  })

  it.each(['short_cta', 'long_update'] as const)(
    'puts a %s photo after the text and the button at the bottom',
    async (layout) => {
      const { html } = await renderEmailTemplate(
        letter({
          layout,
          blocks: [
            { type: 'heading', text: 'Ward 2 update', level: 1 },
            { type: 'paragraph', text: 'Thank you,\nRenee' },
            { type: 'button', label: 'RSVP', url: 'https://example.org/a' },
            {
              type: 'image',
              url: 'https://cdn.example.com/a.jpg',
              alt: 'Renee at the park',
            },
          ],
        }),
        WIN,
      )
      expect(html.match(/<img/g)).toHaveLength(1)
      expect(html.indexOf('Renee<')).toBeLessThan(html.indexOf('<img'))
      expect(html.indexOf('RSVP')).toBeLessThan(html.indexOf('<img'))
      expect(html.indexOf('<img')).toBeLessThan(html.indexOf('Paid for by'))
      expect(html).toMatch(/<img[^>]*width="600"/)
    },
  )

  describe('personal_letter', () => {
    const example = EMAIL_CONTENT_EXAMPLES.personal_letter.win
    const colors = EMAIL_THEMES.cream_and_forest.colors

    it('has no header, an outlined button and a padded, centered photo', async () => {
      const { html, text } = await renderEmailTemplate(example, WIN)
      expect(html).not.toContain('class="em-header"')
      expect(html).not.toContain('class="em-rule"')
      expect(html).not.toContain('<h1')
      expect(html).not.toContain('class="em-cta"')
      expect(html).toMatch(
        new RegExp(
          `border:2px solid ${colors.cta}[\\s\\S]*?<a[^>]*class="em-cta-link"[^>]*color:${colors.cta}[^>]*text-decoration:none[^>]*>See where I stand</a>`,
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

  describe('photo_letter', () => {
    const example = EMAIL_CONTENT_EXAMPLES.photo_letter.win
    const colors = EMAIL_THEMES.cyan.colors

    it('renders the fixed letter', async () => {
      expect(await renderEmailTemplate(example, WIN)).toMatchSnapshot()
      expect(
        await renderEmailTemplate(EMAIL_CONTENT_EXAMPLES.photo_letter.serve, {
          ...WIN,
          paidForBy: null,
        }),
      ).toMatchSnapshot()
    })

    it('draws the parts in their fixed order on the color tint', async () => {
      const { html } = await renderEmailTemplate(example, WIN)
      const order = [
        'images/email-samples/street.jpg',
        '<h1',
        'I’m running for City Council',
        'images/email-samples/hills.jpg',
        'Reply and tell me',
        'Volunteer with Dana',
        'Dana Ortiz<',
        'Candidate for City Council<',
        'My public profile',
        EMAIL_POSTAL_ADDRESS,
      ].map((part) => html.indexOf(part))
      expect(order).not.toContain(-1)
      expect(order).toEqual([...order].sort((a, b) => a - b))
      expect(html).toMatch(new RegExp(`<body[^>]*bgcolor="${colors.bg}"`))
    })

    it('fills the text column with both photos at 8px corners', async () => {
      const { html } = await renderEmailTemplate(example, WIN)
      const photos = html.match(/<img[^>]*email-samples\/[a-z]+\.jpg[^>]*>/g)
      expect(photos).toHaveLength(2)
      for (const photo of photos ?? []) {
        expect(photo).toContain('width="504"')
        expect(photo).toContain('width:100%')
        expect(photo).toContain('border-radius:8px')
      }
    })

    it('sets a semibold headline and 16/26 body text', async () => {
      const { html } = await renderEmailTemplate(example, WIN)
      expect(html).toMatch(/<h1[^>]*font-size:24px[^>]*font-weight:600/)
      expect(html).toMatch(
        /<p[^>]*class="em-body"[^>]*font-size:16px;line-height:26px/,
      )
    })

    it('links the profile beside the logo, in the template color', async () => {
      const { html } = await renderEmailTemplate(example, WIN)
      expect(html).toContain('images/email-samples/goodparty-heart.png')
      expect(html).toMatch(
        new RegExp(
          `<a[^>]*href="https://goodparty.org/people/dana-ortiz-1a2b3c4d"[^>]*color:${colors.cta};[^>]*font-size:12px[^>]*>My public profile</a>`,
        ),
      )
    })

    it('leaves out the profile link without a profile, and an empty signature', async () => {
      const { html: serve } = await renderEmailTemplate(
        EMAIL_CONTENT_EXAMPLES.photo_letter.serve,
        SERVE,
      )
      expect(serve).toContain('City Council Member<br/>')
      expect(serve).toContain('Maplewood, District 4<')
      expect(serve).not.toContain('My public profile')
      const { html: unsigned } = await renderEmailTemplate(
        {
          ...example,
          blocks: [
            { type: 'paragraph', text: 'Hello' },
            {
              type: 'signature',
              name: '',
              office: '',
              imageUrl: '',
              profileUrl: 'https://goodparty.org/people/dana-ortiz-1a2b3c4d',
            },
          ],
        },
        WIN,
      )
      expect(unsigned).not.toContain('My public profile')
    })

    it('draws a signature image above the name', async () => {
      const { html } = await renderEmailTemplate(
        {
          ...example,
          blocks: [
            { type: 'paragraph', text: 'Hello' },
            {
              type: 'signature',
              name: 'Dana Ortiz',
              office: '',
              imageUrl: 'https://cdn.example.com/signature.png',
              profileUrl: '',
            },
          ],
        },
        WIN,
      )
      expect(html).toMatch(
        /<img alt="Dana Ortiz’s signature"[^>]*height="48"[^>]*src="https:\/\/cdn.example.com\/signature.png"/,
      )
      expect(html.indexOf('signature.png')).toBeLessThan(
        html.indexOf('Dana Ortiz<'),
      )
    })

    it.each(EMAIL_LETTER_THEMES)(
      'fills the button with %s and keeps its text white',
      async (theme) => {
        const { html } = await renderEmailTemplate({ ...example, theme }, WIN)
        const themeColors = EMAIL_THEMES[theme].colors
        expect(themeColors.ctaText).toBe('#FFFFFF')
        expect(html).toMatch(
          new RegExp(
            `<td[^>]*bgcolor="${themeColors.cta}"[^>]*class="em-cta"[\\s\\S]*?<a[^>]*color:#FFFFFF;[^>]*font-size:16px;font-weight:600[^>]*>Volunteer with Dana</a>`,
          ),
        )
      },
    )
  })

  it('renders an empty alt when a photo has no description', async () => {
    const { html } = await renderEmailTemplate(
      letter({
        blocks: [
          { type: 'paragraph', text: 'Thank you' },
          { type: 'image', url: 'https://cdn.example.com/a.jpg', alt: '' },
        ],
      }),
      WIN,
    )
    expect(html).toContain('alt=""')
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

  it.each(LAYOUTS)(
    'keeps only the unsubscribe link out of click tracking in %s',
    async (layout) => {
      const { html } = await renderEmailTemplate(
        letter({
          layout,
          blocks: [
            { type: 'paragraph', text: 'Come by.' },
            {
              type: 'button',
              label: 'RSVP',
              url: 'https://example.com/rsvp',
            },
          ],
        }),
        WIN,
      )
      const anchors = html.match(/<a\s[^>]*>/g) ?? []
      const untracked = anchors.filter((a) => a.includes('ses:no-track'))
      expect(anchors.length).toBeGreaterThan(1)
      expect(untracked).toHaveLength(1)
      expect(untracked[0]).toContain('href="{{unsubscribe_url}}"')
      expect(
        anchors.find((a) => a.includes('https://example.com/rsvp')),
      ).not.toContain('ses:no-track')
    },
  )

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

  it.each(EMAIL_CLASSIC_LAYOUT_PRESETS)(
    'renders every block in %s, in order, whatever the layout usually holds',
    async (layout) => {
      const { html } = await renderEmailTemplate(
        letter({
          layout,
          blocks: [
            { type: 'paragraph', text: 'First words' },
            { type: 'heading', text: 'Big news', level: 1 },
            { type: 'paragraph', text: 'Middle words' },
            { type: 'heading', text: 'Smaller news', level: 2 },
            { type: 'divider' },
            { type: 'paragraph', text: 'x'.repeat(1500) },
            { type: 'paragraph', text: 'Last words' },
          ],
        }),
        WIN,
      )
      const order = [
        'First words',
        'Middle words',
        'Smaller news',
        'class="em-divider"',
        'Last words',
      ].map((part) => html.indexOf(part))
      expect(order).not.toContain(-1)
      expect(order).toEqual([...order].sort((a, b) => a - b))
      expect(html).toContain('Big news')
      expect(html).toContain('x'.repeat(1500))
      expect(html).not.toContain('class="em-accent"')
    },
  )

  it('puts the preview text in the inbox preview but not the plain text', async () => {
    const { html, text } = await renderEmailTemplate(
      letter({ previewText: 'Coffee is on me' }),
      WIN,
    )
    expect(html).toContain('Coffee is on me')
    expect(text).not.toContain('Coffee is on me')
  })
})
