import type { ReactElement } from 'react'
import { render } from '@react-email/render'
import {
  EMAIL_THEMES,
  EmailContentDraftSchema,
  type EmailBlockDraft,
  type EmailContentDraft,
  type EmailLayoutPresetKey,
} from '@goodparty_org/contracts'
import { EmailShell } from './components'
import { LongUpdateLayout } from './layouts/LongUpdateLayout'
import { PersonalLetterLayout } from './layouts/PersonalLetterLayout'
import { ShortCtaLayout } from './layouts/ShortCtaLayout'
import type {
  EmailTemplateContext,
  LayoutProps,
  RenderedEmailTemplate,
} from './emailTemplate.types'
import {
  protectUrl,
  protectUserText,
  restoreHtml,
  restorePlainText,
} from './emailVariables.util'

const LAYOUTS: Record<
  EmailLayoutPresetKey,
  {
    Component: (props: LayoutProps) => ReactElement
    page: 'bg' | 'card'
  }
> = {
  short_cta: { Component: ShortCtaLayout, page: 'bg' },
  long_update: { Component: LongUpdateLayout, page: 'bg' },
  personal_letter: { Component: PersonalLetterLayout, page: 'card' },
}

// A draft may still hold empty blocks; they render as nothing. A button
// without its link yet points nowhere, which only a preview can reach: a
// send is checked against EmailContentSchema first.
const protectBlock = (block: EmailBlockDraft): EmailBlockDraft[] => {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      return block.text ? [{ ...block, text: protectUserText(block.text) }] : []
    case 'image':
      return block.url
        ? [
            {
              ...block,
              url: protectUrl(block.url),
              alt: protectUserText(block.alt),
            },
          ]
        : []
    case 'button':
      return block.label
        ? [
            {
              ...block,
              label: protectUserText(block.label),
              url: block.url ? protectUrl(block.url) : '#',
            },
          ]
        : []
    case 'divider':
      return [block]
  }
}

// Returns the SES template parts. `{{first_name}}` and `{{last_name}}` stay as
// variables and `{{unsubscribe_url}}` is the footer link's placeholder;
// anything else a user typed, braces included, is escaped.
export const renderEmailTemplate = async (
  content: EmailContentDraft,
  context: EmailTemplateContext,
): Promise<RenderedEmailTemplate> => {
  const parsed = EmailContentDraftSchema.parse(content)
  const colors = EMAIL_THEMES[parsed.theme].colors
  const { Component, page } = LAYOUTS[parsed.layout]
  const subject = protectUserText(parsed.subject)
  const element = (
    <EmailShell
      colors={colors}
      subject={subject}
      previewText={
        parsed.previewText ? protectUserText(parsed.previewText) : undefined
      }
      background={page}
    >
      <Component
        colors={colors}
        blocks={parsed.blocks.flatMap(protectBlock)}
        context={{
          senderName: protectUserText(context.senderName),
          paidForBy: context.paidForBy
            ? protectUserText(context.paidForBy)
            : null,
          sendDate: context.sendDate,
        }}
      />
    </EmailShell>
  )
  const [html, text] = await Promise.all([
    render(element),
    render(element, {
      plainText: true,
      htmlToTextOptions: {
        selectors: [
          { selector: 'img', format: 'skip' },
          { selector: '#__react-email-preview', format: 'skip' },
          { selector: 'h1', options: { uppercase: false } },
          { selector: 'h2', options: { uppercase: false } },
        ],
      },
    }),
  ])
  return {
    html: restoreHtml(html),
    text: restorePlainText(text),
    subject: restorePlainText(subject),
  }
}
