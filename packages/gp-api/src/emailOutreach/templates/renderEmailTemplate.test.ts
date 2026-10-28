import { describe, expect, it } from 'vitest'
import {
  EMAIL_LAYOUTS,
  EMAIL_THEMES,
  type EmailLayoutKey,
  type EmailThemeKey,
} from '@goodparty_org/contracts'
import { EMAIL_POSTAL_ADDRESS } from './emailTemplate.const'
import type { EmailTemplateContent } from './emailTemplate.types'
import { renderEmailTemplate } from './renderEmailTemplate'

const content = (
  overrides: Partial<EmailTemplateContent> = {},
): EmailTemplateContent => ({
  subject: 'Join us Saturday',
  headline: 'Come say hello',
  body: 'Hi {{first_name}} {{last_name}},\n\nWe would love to see you.',
  imageUrl: null,
  button: { label: 'RSVP', url: 'https://example.com/rsvp?a=1&b=2' },
  footer: { senderName: 'Renee Wells', paidForBy: 'Wells for Mayor' },
  ...overrides,
})

const LAYOUTS = Object.keys(EMAIL_LAYOUTS) as EmailLayoutKey[]
const THEMES = Object.keys(EMAIL_THEMES) as EmailThemeKey[]

describe('renderEmailTemplate', () => {
  it.each(LAYOUTS.flatMap((layout) => THEMES.map((theme) => [layout, theme])))(
    'renders %s in %s with variables, footer and dark-mode safeguards',
    async (layout, theme) => {
      const colors = EMAIL_THEMES[theme as EmailThemeKey].colors
      const { html, text } = await renderEmailTemplate(
        layout as EmailLayoutKey,
        theme as EmailThemeKey,
        content({ imageUrl: 'https://cdn.example.com/a.jpg' }),
      )

      expect(html).toContain('{{first_name}}')
      expect(html).toContain('{{last_name}}')
      expect(text).toContain('{{first_name}}')
      expect(html).toContain('{{unsubscribe_url}}')
      expect(html).toContain(EMAIL_POSTAL_ADDRESS)
      expect(text).toContain(EMAIL_POSTAL_ADDRESS)
      expect(html).toContain('Paid for by Wells for Mayor')
      expect(html).toContain('you asked to hear from')
      expect(html).toContain('name="color-scheme" content="light only"')
      expect(html).toContain(`bgcolor="${colors.bg}"`)
      expect(html).toContain(`bgcolor="${colors.card}"`)
      expect(html).toContain(`bgcolor="${colors.header}"`)
      expect(html).toContain(`bgcolor="${colors.rule}"`)
      expect(html).toContain(`background-color:${colors.rule}`)
      expect(html).toContain('prefers-color-scheme:dark')
      expect(html).toContain('src="https://cdn.example.com/a.jpg"')
    },
  )

  it('draws the rule line under cream_and_forest light header', async () => {
    const { html } = await renderEmailTemplate(
      'newsletter',
      'cream_and_forest',
      content(),
    )
    const colors = EMAIL_THEMES.cream_and_forest.colors
    expect(colors.header).not.toBe(colors.rule)
    expect(html).toMatch(
      new RegExp(`bgcolor="${colors.rule}" class="em-rule"[^>]*height="3"`),
    )
    expect(html).toContain(`bgcolor="${colors.header}" class="em-header"`)
  })

  it('omits the Paid for by line when paidForBy is null (Serve)', async () => {
    const { html, text } = await renderEmailTemplate(
      'newsletter',
      'classic_blue',
      content({ footer: { senderName: 'Renee Wells', paidForBy: null } }),
    )
    expect(html).not.toContain('Paid for by')
    expect(text).not.toContain('Paid for by')
    expect(html).toContain(EMAIL_POSTAL_ADDRESS)
  })

  it('escapes html in every user field', async () => {
    const { html } = await renderEmailTemplate(
      'newsletter',
      'classic_blue',
      content({
        subject: '<b>hi</b>',
        headline: '<script>alert(1)</script>',
        body: '<img src=x onerror=alert(1)>',
        button: { label: '<i>go</i>', url: 'https://example.com/' },
        footer: { senderName: '<u>Renee</u>', paidForBy: '<s>Committee</s>' },
      }),
    )
    expect(html).not.toContain('<script>alert')
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<b>hi</b>')
    expect(html).not.toContain('<i>go</i>')
    expect(html).not.toContain('<u>Renee</u>')
    expect(html).not.toContain('<s>Committee</s>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('never lets a user-typed {{ become a template variable', async () => {
    const typed = '{{unsubscribe_url}} {{ first_name }} {{secret}} {{{x}}}'
    const label = '{{secret}} {{{x}}}'
    const { html, text, subject } = await renderEmailTemplate(
      'reminder',
      'fresh_green',
      content({
        subject: typed,
        headline: typed,
        body: typed,
        button: { label, url: 'https://example.com/{{secret}}' },
        footer: { senderName: typed, paidForBy: typed },
      }),
    )

    const variablesIn = (value: string) => [
      ...new Set(value.match(/\{\{[^}]*\}\}/g) ?? []),
    ]
    expect(variablesIn(html).sort()).toEqual(['{{unsubscribe_url}}'])
    expect(variablesIn(text).sort()).toEqual(['{{unsubscribe_url}}'])
    expect(variablesIn(subject)).toEqual([])
    expect(html).toContain('&#123;&#123;secret&#125;&#125;')
    expect(html).toContain('%7B%7Bsecret%7D%7D')
  })

  it('keeps the merge tags in the subject', async () => {
    const { subject } = await renderEmailTemplate(
      'newsletter',
      'classic_blue',
      content({ subject: 'See you, {{first_name}}' }),
    )
    expect(subject).toBe('See you, {{first_name}}')
  })

  it('renders paragraphs and line breaks from the body', async () => {
    const { html } = await renderEmailTemplate(
      'newsletter',
      'classic_blue',
      content({ body: 'One\nTwo\n\nThree' }),
    )
    expect(html.match(/<br\/?>/g)).toHaveLength(1)
    expect(html.match(/class="em-body"/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('omits the optional blocks when they are not given', async () => {
    const { html, text } = await renderEmailTemplate(
      'newsletter',
      'classic_blue',
      content({ headline: null, imageUrl: null, button: null }),
    )
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<h1')
    expect(html).not.toContain('RSVP')
    expect(text).not.toContain('RSVP')
  })

  it('requires a button on the call to action layout', async () => {
    await expect(
      renderEmailTemplate('call_to_action', 'cream_and_forest', {
        ...content(),
        button: null,
      }),
    ).rejects.toThrow('needs a button')
  })

  it('rejects links that are not https', async () => {
    await expect(
      renderEmailTemplate(
        'newsletter',
        'classic_blue',
        content({ button: { label: 'Go', url: 'javascript:alert(1)' } }),
      ),
    ).rejects.toThrow()
    await expect(
      renderEmailTemplate(
        'newsletter',
        'classic_blue',
        content({ imageUrl: 'http://example.com/a.png' }),
      ),
    ).rejects.toThrow()
  })

  it('puts the button label and link in the plain text', async () => {
    const { text } = await renderEmailTemplate(
      'call_to_action',
      'cream_and_forest',
      content(),
    )
    expect(text).toContain('RSVP')
    expect(text).toContain('https://example.com/rsvp?a=1&b=2')
  })
})
