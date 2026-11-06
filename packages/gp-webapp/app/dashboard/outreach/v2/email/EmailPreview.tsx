import { useEffect, useRef, useState } from 'react'
import {
  EmailContentDraftSchema,
  type EmailContentDraft,
} from '@goodparty_org/contracts'
import { apiErrorMessage, previewEmail } from './emailApi'

export const EMAIL_PREVIEW_DEBOUNCE_MS = 400

const isHttpsUrl = (value: string): boolean => {
  try {
    return new URL(value.trim()).protocol === 'https:'
  } catch {
    return false
  }
}

// A link still being typed ("http") breaks the draft rules, which would hold
// the preview back until it is finished.
const withoutPartialLinks = (
  content: EmailContentDraft,
): EmailContentDraft => ({
  ...content,
  blocks: content.blocks.map((block) =>
    block.type === 'button' && !isHttpsUrl(block.url)
      ? { ...block, url: '' }
      : block,
  ),
})

interface EmailPreviewProps {
  serve: boolean
  content: EmailContentDraft
  // Shown in a strip above the email, where an inbox shows it.
  subject?: string
}

// The sent email, rendered by gp-api's template. The last good render stays
// up while the next one loads, and while the blocks break a rule the editor
// already shows next to them.
export const EmailPreview = ({
  serve,
  content,
  subject,
}: EmailPreviewProps) => {
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [height, setHeight] = useState(480)
  const frame = useRef<HTMLIFrameElement>(null)
  const key = JSON.stringify(content)
  const requested = useRef(0)
  const shown = useRef(0)
  const mounted = useRef(true)
  // The first request after mount goes out at once, so opening the preview
  // always shows the email as it is now; later edits are debounced, whether
  // or not that first one succeeded.
  const requestedOnce = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    const parsed = EmailContentDraftSchema.safeParse(
      withoutPartialLinks(JSON.parse(key)),
    )
    setBlocked(!parsed.success)
    if (!parsed.success) return
    const delay = requestedOnce.current ? EMAIL_PREVIEW_DEBOUNCE_MS : 0
    const timer = setTimeout(async () => {
      requestedOnce.current = true
      const id = ++requested.current
      try {
        const next = await previewEmail(serve, { content: parsed.data })
        // A slow answer to an older edit still shows, but never replaces the
        // answer to a newer one.
        if (!mounted.current || id < shown.current) return
        shown.current = id
        setHtml(next)
        if (id === requested.current) setError(null)
      } catch (err) {
        if (mounted.current && id === requested.current) {
          setError(apiErrorMessage(err))
        }
      }
    }, delay)
    return () => clearTimeout(timer)
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
      {subject !== undefined && (
        <div
          className="rounded-lg border border-border bg-muted px-4 py-3 text-sm"
          data-testid="email-preview-subject"
        >
          <span className="text-muted-foreground">Subject: </span>
          <span className="font-medium text-foreground">
            {subject.trim() || 'No subject yet'}
          </span>
        </div>
      )}
      {blocked && (
        <p className="text-xs text-muted-foreground">
          Fix the errors in your email to update the preview.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {`Preview could not update. ${error}`}
        </p>
      )}
      {html === null ? (
        !error &&
        !blocked && (
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
