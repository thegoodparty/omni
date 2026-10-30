import { useEffect, useRef, useState } from 'react'
import {
  EmailContentDraftSchema,
  type EmailContentDraft,
} from '@goodparty_org/contracts'
import { apiErrorMessage, previewEmail } from './emailApi'

export const EMAIL_PREVIEW_DEBOUNCE_MS = 400

interface EmailPreviewProps {
  serve: boolean
  content: EmailContentDraft
}

// The sent email, rendered by gp-api's template. The last good render stays
// up while the next one loads, and while the blocks break a rule the editor
// already shows next to them.
export const EmailPreview = ({ serve, content }: EmailPreviewProps) => {
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [height, setHeight] = useState(480)
  const frame = useRef<HTMLIFrameElement>(null)
  const key = JSON.stringify(content)

  useEffect(() => {
    const parsed = EmailContentDraftSchema.safeParse(JSON.parse(key))
    if (!parsed.success) return
    let current = true
    const timer = setTimeout(async () => {
      try {
        const next = await previewEmail(serve, { content: parsed.data })
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
  }, [serve, key])

  const fit = () => {
    const doc = frame.current?.contentDocument
    if (doc?.body) setHeight(doc.body.scrollHeight)
  }

  return (
    <div
      data-testid="email-preview"
      data-layout={content.layout}
      data-theme={content.theme}
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
