'use client'

import { useEffect, useState } from 'react'
import {
  EMAIL_CONTENT_EXAMPLES,
  EMAIL_LAYOUT_PRESETS,
  EMAIL_THEMES,
  EmailLayoutPresetKeySchema,
  type EmailContent,
} from '@goodparty_org/contracts'
import {
  apiErrorMessage,
  previewEmail,
} from '../../dashboard/outreach/v2/email/emailApi'

const MODES = ['win', 'serve'] as const

const ExamplePreview = ({
  serve,
  content,
}: {
  serve: boolean
  content: EmailContent
}) => {
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [height, setHeight] = useState(480)

  useEffect(() => {
    let current = true
    previewEmail(serve, { content })
      .then((next) => current && setHtml(next))
      .catch((err) => current && setError(apiErrorMessage(err)))
    return () => {
      current = false
    }
  }, [serve, content])

  if (error) {
    return (
      <p role="alert" className="text-xs text-destructive">
        {error}
      </p>
    )
  }
  if (html === null) {
    return (
      <div className="h-48 animate-pulse rounded-lg border border-border bg-muted" />
    )
  }
  return (
    <iframe
      title="Email preview"
      srcDoc={html}
      sandbox="allow-same-origin"
      onLoad={(event) => {
        const body = event.currentTarget.contentDocument?.body
        if (body) setHeight(body.scrollHeight)
      }}
      style={{ height }}
      className="w-full rounded-lg border border-border bg-white"
    />
  )
}

const DevEmailTemplateGallery = () => {
  if (process.env.NODE_ENV !== 'development') {
    return <p className="p-8">Not available in production.</p>
  }

  return (
    <div className="space-y-10 p-8" data-testid="email-template-gallery">
      <h1 className="text-2xl font-bold">Email template gallery</h1>
      <p className="text-sm text-muted-foreground">
        The Win and Serve example for each layout, rendered by gp-api&apos;s
        email templates. Win cards need a signed-in campaign user and Serve
        cards an elected office.
      </p>
      {EmailLayoutPresetKeySchema.options.map((layout) => (
        <section key={layout} className="space-y-4">
          <h2 className="text-xl font-semibold">
            {EMAIL_LAYOUT_PRESETS[layout].label}
          </h2>
          <div className="grid gap-6 md:grid-cols-2">
            {MODES.map((mode) => {
              const content = EMAIL_CONTENT_EXAMPLES[layout][mode]
              return (
                <div
                  key={mode}
                  data-testid={`email-gallery-${layout}-${mode}`}
                  className="space-y-2"
                >
                  <p className="text-sm font-medium">
                    {`${mode === 'win' ? 'Win' : 'Serve'}, ${EMAIL_THEMES[content.theme].label}`}
                  </p>
                  <ExamplePreview serve={mode === 'serve'} content={content} />
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

export default DevEmailTemplateGallery
