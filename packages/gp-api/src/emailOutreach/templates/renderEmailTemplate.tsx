import { render } from '@react-email/render'
import {
  EMAIL_LAYOUTS,
  EMAIL_THEMES,
  type EmailLayoutKey,
  type EmailThemeKey,
} from '@goodparty_org/contracts'
import { EmailShell, type LayoutProps } from './components'
import { CallToActionLayout } from './layouts/CallToActionLayout'
import { NewsletterLayout } from './layouts/NewsletterLayout'
import { ReminderLayout } from './layouts/ReminderLayout'
import {
  emailTemplateContentSchema,
  type EmailTemplateContent,
  type RenderedEmailTemplate,
} from './emailTemplate.types'
import {
  protectUrl,
  protectUserText,
  restoreHtml,
  restorePlainText,
} from './emailVariables.util'

const LAYOUT_COMPONENTS: Record<
  EmailLayoutKey,
  (props: LayoutProps) => ReturnType<typeof NewsletterLayout>
> = {
  newsletter: NewsletterLayout,
  reminder: ReminderLayout,
  call_to_action: CallToActionLayout,
}

const protectContent = (
  content: EmailTemplateContent,
): EmailTemplateContent => ({
  subject: protectUserText(content.subject),
  headline: content.headline ? protectUserText(content.headline) : null,
  body: protectUserText(content.body),
  imageUrl: content.imageUrl ? protectUrl(content.imageUrl) : null,
  button: content.button
    ? {
        label: protectUserText(content.button.label),
        url: protectUrl(content.button.url),
      }
    : null,
  footer: {
    senderName: protectUserText(content.footer.senderName),
    paidForBy: content.footer.paidForBy
      ? protectUserText(content.footer.paidForBy)
      : null,
  },
})

// Returns the SES template parts. `{{first_name}}` and `{{last_name}}` stay as
// variables and `{{unsubscribe_url}}` is the footer link's placeholder;
// anything else a user typed, braces included, is escaped.
export const renderEmailTemplate = async (
  layoutKey: EmailLayoutKey,
  themeKey: EmailThemeKey,
  content: EmailTemplateContent,
): Promise<RenderedEmailTemplate> => {
  const parsed = emailTemplateContentSchema.parse(content)
  if (EMAIL_LAYOUTS[layoutKey].requiresButton && !parsed.button) {
    throw new Error(`The ${layoutKey} layout needs a button`)
  }
  const protectedContent = protectContent(parsed)
  const colors = EMAIL_THEMES[themeKey].colors
  const Layout = LAYOUT_COMPONENTS[layoutKey]
  const element = (
    <EmailShell colors={colors} subject={protectedContent.subject}>
      <Layout colors={colors} content={protectedContent} />
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
        ],
      },
    }),
  ])
  return {
    html: restoreHtml(html),
    text: restorePlainText(text),
    subject: restorePlainText(protectedContent.subject),
  }
}
