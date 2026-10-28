import {
  EMAIL_THEMES,
  MERGE_TAGS,
  type EmailLayoutKey,
  type EmailThemeKey,
} from '@goodparty_org/contracts'

interface EmailPreviewProps {
  layout: EmailLayoutKey
  theme: EmailThemeKey
  senderName: string
  headline: string
  body: string
  buttonLabel: string
  buttonUrl: string
}

const FIRST_NAME = MERGE_TAGS[0]

const withSampleName = (text: string): string =>
  text.split(FIRST_NAME.token.email).join(FIRST_NAME.sample)

// An approximation of the sent email for the compose and review steps. The
// real render is gp-api's template; this follows the same color roles.
export const EmailPreview = ({
  layout,
  theme,
  senderName,
  headline,
  body,
  buttonLabel,
  buttonUrl,
}: EmailPreviewProps) => {
  const c = EMAIL_THEMES[theme].colors
  const hasButton = buttonLabel.trim() !== '' && buttonUrl.trim() !== ''
  const text = withSampleName(body)

  return (
    <div
      data-testid="email-preview"
      data-layout={layout}
      data-theme={theme}
      className="overflow-hidden rounded-lg border border-border p-3"
      style={{ backgroundColor: c.bg }}
    >
      <div
        className="mx-auto max-w-[520px] overflow-hidden rounded-md"
        style={{ backgroundColor: c.card }}
      >
        <div
          className="px-5 py-3 text-sm font-semibold"
          style={{
            backgroundColor: c.header,
            color: c.headerText,
            borderBottom: `2px solid ${c.rule}`,
          }}
        >
          {senderName}
        </div>
        <div className="space-y-3 px-5 py-5">
          {headline.trim() && (
            <h4
              className="text-xl font-bold leading-tight"
              style={{ color: c.headline }}
            >
              {headline}
            </h4>
          )}
          {layout === 'reminder' && (
            <div
              className="inline-block rounded px-2 py-1 text-xs font-semibold uppercase"
              style={{ backgroundColor: c.accent, color: c.accentText }}
            >
              Reminder
            </div>
          )}
          <p
            className="whitespace-pre-line text-sm leading-relaxed"
            style={{ color: c.body }}
          >
            {text.trim() || 'Your message shows up here.'}
          </p>
          {hasButton && (
            <div
              className={layout === 'call_to_action' ? 'py-2 text-center' : ''}
            >
              <span
                className="inline-block rounded-md px-5 py-2.5 text-sm font-semibold"
                style={{ backgroundColor: c.cta, color: c.ctaText }}
              >
                {buttonLabel}
              </span>
            </div>
          )}
        </div>
        <div
          className="px-5 py-3 text-xs"
          style={{ color: c.meta, borderTop: `1px solid ${c.divider}` }}
        >
          Unsubscribe
        </div>
      </div>
    </div>
  )
}
