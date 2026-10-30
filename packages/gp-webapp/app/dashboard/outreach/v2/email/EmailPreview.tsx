import { useEffect, useRef, useState } from 'react'
import type { EmailLayoutKey, EmailThemeKey } from '@goodparty_org/contracts'
import { apiErrorMessage, previewEmail } from './emailApi'

export const EMAIL_PREVIEW_DEBOUNCE_MS = 400

interface EmailPreviewProps {
  serve: boolean
  layout: EmailLayoutKey
  theme: EmailThemeKey
  subject: string
  headline: string
  body: string
  buttonLabel: string
  buttonUrl: string
  imageUrl?: string
}

// The sent email, rendered by gp-api's template. The last good render stays
// up while the next one loads.
export const EmailPreview = ({
  serve,
  layout,
  theme,
  subject,
  headline,
  body,
  buttonLabel,
  buttonUrl,
  imageUrl,
}: EmailPreviewProps) => {
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [height, setHeight] = useState(480)
  const frame = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    let current = true
    const timer = setTimeout(async () => {
      try {
        const next = await previewEmail(serve, {
          layout,
          theme,
          subject,
          body,
          ...(headline.trim() && { headline }),
          ...(imageUrl && { imageUrl }),
          ...(buttonLabel.trim() &&
            buttonUrl.trim() && { buttonLabel, buttonUrl }),
        })
        if (!current) return
        setHtml(next)
        setError(null)
      } catch (err) {
        if (current) setError(apiErrorMessage(err))
      }
    }, EMAIL_PREVIEW_DEBOUNCE_MS)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [
    serve,
    layout,
    theme,
    subject,
    headline,
    body,
    buttonLabel,
    buttonUrl,
    imageUrl,
  ])

  const fit = () => {
    const doc = frame.current?.contentDocument
    if (doc?.body) setHeight(doc.documentElement.scrollHeight)
  }

  return (
    <div
      data-testid="email-preview"
      data-layout={layout}
      data-theme={theme}
      className="space-y-2"
    >
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {`Preview could not update. ${error}`}
        </p>
      )}
      {html === null ? (
        !error && (
          <div className="h-48 animate-pulse rounded-lg border border-border bg-muted" />
        )
      ) : (
        <iframe
          ref={frame}
          title="Email preview"
          srcDoc={html}
          sandbox="allow-same-origin"
          onLoad={fit}
          style={{ height }}
          className="w-full rounded-lg border border-border bg-white"
        />
      )}
    </div>
  )
}
