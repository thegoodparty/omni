'use client'
import {
  Alert,
  AlertDescription,
  Button,
  CheckIcon,
  CircleAlertIcon,
  Input,
  LoaderCircleIcon,
  WandSparklesIcon,
  XMarkIcon,
} from '@styleguide'
import dynamic from 'next/dynamic'
import { useRef, useState } from 'react'
import { FetchError } from 'ofetch'
import { clientRequest } from 'gpApi/typed-request'
import { reportErrorToSentry } from '@shared/sentry'
import { issueDescriptionText } from '@shared/utils/issueDescriptionText'
import { WebsiteIssue } from 'helpers/types'
import {
  MIN_POLICY_FOCUS_LENGTH,
  getBioPlainLength,
  getPolicyFormValidation,
} from '../candidateProfile.utils'

const RichEditor = dynamic(() => import('app/shared/utils/RichEditor'), {
  ssr: false,
  loading: () => (
    <div className="rounded-md border border-input bg-white px-3 py-2 text-sm text-muted-foreground">
      Loading editor…
    </div>
  ),
})

interface PolicyFormProps {
  initial?: WebsiteIssue
  showDelete: boolean
  onSave: (issue: WebsiteIssue) => void
  onDelete: () => void
  // Hide the editor's formatting toolbar (plain-text feel) — used by the
  // Campaign Story surface.
  hideToolbar?: boolean
}

export default function PolicyForm({
  initial,
  showDelete,
  onSave,
  onDelete,
  hideToolbar,
}: PolicyFormProps): React.JSX.Element {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  // Seed the length from the existing description so Save isn't falsely
  // blocked before the dynamically-loaded editor fires its first
  // onTextLengthChange when editing an existing policy.
  const [descriptionPlainLength, setDescriptionPlainLength] = useState(() =>
    getBioPlainLength(initial?.description),
  )
  // The editor seed + a remount key: accepting a rewrite replaces the editor
  // content by remounting it with the suggestion as the new initial text
  // (RichEditor only pastes initialText on mount).
  const [editorSeed, setEditorSeed] = useState(initial?.description ?? '')
  const [editorKey, setEditorKey] = useState(0)
  // The Save button is always enabled so the user can attempt to save and get
  // a guiding error instead of a silently-disabled button. Errors (alert +
  // red field borders) only surface once they've tried to save.
  const [attemptedSave, setAttemptedSave] = useState(false)

  // AI "Help me rewrite" for the Policy focus. `rewrite` holds the latest
  // draft; the suggestion card shows whenever we're generating, have a draft,
  // or hit an error.
  const [rewrite, setRewrite] = useState<string | null>(null)
  const [isRewriting, setIsRewriting] = useState(false)
  const [rewriteError, setRewriteError] = useState(false)
  // Set on a 403 — the campaign hit its lifetime AI rewrite cap. Permanent for
  // the session: no point retrying.
  const [limitReached, setLimitReached] = useState(false)
  // Guards against overlapping rewrite calls so an older response can't resolve
  // after a newer one and show a stale suggestion.
  const rewritingRef = useRef(false)
  const rewriteActive = isRewriting || rewrite !== null || rewriteError

  const trimmedTitle = title.trim()
  const { titleInvalid, focusInvalid, message } = getPolicyFormValidation(
    trimmedTitle.length,
    descriptionPlainLength,
  )

  const handleSave = () => {
    if (message) {
      setAttemptedSave(true)
      return
    }
    onSave({ title: trimmedTitle, description })
  }

  const discardRewrite = (): void => {
    setRewrite(null)
    setRewriteError(false)
  }

  const requestRewrite = async (): Promise<void> => {
    // The endpoint rewrites plain text; the editor stores Quill HTML.
    const text = issueDescriptionText(description).trim()
    if (!text || rewritingRef.current || limitReached) return
    rewritingRef.current = true
    setIsRewriting(true)
    setRewriteError(false)
    setRewrite(null)
    try {
      const { data } = await clientRequest(
        'POST /v1/campaigns/mine/story/rewrite',
        { field: 'issue', text, title: trimmedTitle || undefined },
      )
      setRewrite(data.rewrite)
    } catch (error) {
      // 403 = lifetime rewrite cap reached. Expected, not an error to report.
      // Dismiss any prior suggestion so the card and the limit notice don't
      // render together.
      if (error instanceof FetchError && error.status === 403) {
        setLimitReached(true)
        discardRewrite()
      } else {
        reportErrorToSentry(error, { context: 'PolicyForm.rewrite' })
        setRewriteError(true)
      }
    } finally {
      rewritingRef.current = false
      setIsRewriting(false)
    }
  }

  // Replace the editor content with the suggestion by remounting it. The
  // rewrite is raw Gemini text, so escape HTML entities before wrapping it in
  // <p>: otherwise dangerouslyPasteHTML drops a literal '<' and the interim
  // `description` (which Save, always enabled, could persist before the
  // remounted editor emits its real innerHTML) would be malformed HTML.
  const acceptRewrite = (text: string): void => {
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
    setEditorSeed(`<p>${escaped}</p>`)
    setEditorKey((key) => key + 1)
    setDescription(`<p>${escaped}</p>`)
    setDescriptionPlainLength(getBioPlainLength(text))
    discardRewrite()
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 p-6">
      <h2 className="text-lg font-semibold">Policy priority</h2>

      {attemptedSave && message && (
        <Alert variant="destructive" icon={<CircleAlertIcon />}>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-2">
        <label htmlFor="policy-title" className="text-sm font-medium">
          Policy title
        </label>
        <Input
          id="policy-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={attemptedSave && titleInvalid}
          autoFocus
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="text-sm font-medium">Policy focus</div>
        <RichEditor
          key={editorKey}
          initialText={editorSeed}
          onChangeCallback={setDescription}
          onTextLengthChange={setDescriptionPlainLength}
          error={attemptedSave && focusInvalid}
          hideToolbar={hideToolbar}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{MIN_POLICY_FOCUS_LENGTH} character minimum</span>
          <span>{descriptionPlainLength}</span>
        </div>

        {!rewriteActive && (
          <Button
            type="button"
            variant="outline"
            icon={<WandSparklesIcon />}
            onClick={requestRewrite}
            disabled={descriptionPlainLength === 0 || limitReached}
            className="self-start"
          >
            Help me rewrite
          </Button>
        )}

        {limitReached && (
          <p className="text-sm text-muted-foreground">
            You&apos;ve reached your AI rewrite limit for this campaign. You can
            still edit your policy yourself.
          </p>
        )}

        {rewriteActive && (
          <div className="flex flex-col gap-3 rounded-lg border border-primary bg-primary/5 p-4">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-primary">
              <WandSparklesIcon className="size-4" />
              Suggested rewrite
            </span>

            {isRewriting ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircleIcon className="size-4 animate-spin text-primary" />
                Your Campaign Manager is writing a draft&hellip;
              </p>
            ) : rewriteError ? (
              <p className="text-sm text-destructive">
                Couldn&apos;t generate a rewrite. Please try again.
              </p>
            ) : (
              <p className="whitespace-pre-wrap text-base text-foreground">
                {rewrite}
              </p>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                icon={<XMarkIcon />}
                onClick={discardRewrite}
                disabled={isRewriting}
              >
                Discard
              </Button>
              <Button
                type="button"
                variant="outline"
                icon={<WandSparklesIcon />}
                onClick={requestRewrite}
                disabled={isRewriting || limitReached}
              >
                Try again
              </Button>
              <Button
                type="button"
                icon={<CheckIcon />}
                onClick={() => rewrite && acceptRewrite(rewrite)}
                disabled={isRewriting || !rewrite}
              >
                Use this
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between">
        {showDelete ? (
          <Button
            type="button"
            variant="outline"
            size="medium"
            onClick={onDelete}
          >
            Delete
          </Button>
        ) : (
          <span />
        )}
        <Button type="button" size="medium" onClick={handleSave}>
          Save
        </Button>
      </div>
    </div>
  )
}
