'use client'

import {
  EMAIL_LAYOUTS,
  EMAIL_THEMES,
  type EmailLayoutKey,
  type EmailThemeKey,
} from '@goodparty_org/contracts'
import { EmailPreview } from '../../dashboard/outreach/v2/email/EmailPreview'

const LAYOUT_KEYS = Object.keys(EMAIL_LAYOUTS) as EmailLayoutKey[]
const THEME_KEYS = Object.keys(EMAIL_THEMES) as EmailThemeKey[]

const DevEmailTemplateGallery = () => {
  if (process.env.NODE_ENV !== 'development') {
    return <p className="p-8">Not available in production.</p>
  }

  return (
    <div className="space-y-10 p-8" data-testid="email-template-gallery">
      <h1 className="text-2xl font-bold">Email template gallery</h1>
      <p className="text-sm text-muted-foreground">
        Rendered by gp-api&apos;s email templates. Sign in as a campaign user
        first; the previews come from an authed route.
      </p>
      {LAYOUT_KEYS.map((layout) => (
        <section key={layout} className="space-y-4">
          <h2 className="text-xl font-semibold">
            {EMAIL_LAYOUTS[layout].label}
          </h2>
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {THEME_KEYS.map((theme) => (
              <div
                key={theme}
                data-testid={`email-gallery-${layout}-${theme}`}
                className="space-y-2"
              >
                <p className="text-sm font-medium">
                  {EMAIL_THEMES[theme].label}
                </p>
                <EmailPreview
                  serve={false}
                  layout={layout}
                  theme={theme}
                  subject="Join us this Saturday"
                  headline="Join us this Saturday"
                  body={
                    'Hi {{first_name}},\n\nWe are knocking doors and would love your help.'
                  }
                  buttonLabel="Sign up"
                  buttonUrl="https://example.com"
                />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export default DevEmailTemplateGallery
