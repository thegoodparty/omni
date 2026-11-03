import { useCallback, useEffect, useRef, useState } from 'react'
import {
  EMAIL_BODY_MAX_LENGTH,
  EMAIL_CONTENT_TEXT_MAX_LENGTH,
  EMAIL_HEADING_MAX_LENGTH,
  EMAIL_IMAGE_ALLOWED_MIME_TYPES,
  EMAIL_IMAGE_MAX_BYTES,
  EMAIL_MERGE_TAGS,
  EMAIL_SUBJECT_MAX_LENGTH,
  MERGE_TAGS,
  mergeTagToken,
  SOCIAL_TONE_VALUES,
  type SocialTone,
} from '@goodparty_org/contracts'
import {
  Alert,
  AlertAction,
  AlertDescription,
  Button,
  Card,
  cn,
  FilterPill,
  FilterPillGroup,
  IconButton,
  Input,
  Label,
  seamlessFieldHost,
  TokenField,
  type TokenFieldRef,
  type TokenSpec,
} from '@styleguide'
import {
  Loader2Icon,
  MicIcon,
  SquareIcon,
} from '@styleguide/components/ui/icons'
import {
  type DictationStatus,
  useDictation,
} from 'app/dashboard/shared/dictation/useDictation'
import { HiddenFileUploadInput } from '@shared/inputs/HiddenFileUploadInput'
import { Intro } from '../social/Intro'
import { EmailPreview } from './EmailPreview'
import { apiErrorMessage, draftEmailWithAi, uploadEmailImage } from './emailApi'
import {
  applyImprovedDraft,
  fillFromAiDraft,
  hasNoWriting,
  isUntouched,
  snapshot,
  toAiFields,
  toContent,
  writeStepIssues,
  type ComposeField,
  type ComposeFieldError,
  type EmailComposeState,
} from './emailForm.util'
import type { EmailSurface } from './emailSurface'

const FIRST_NAME_TAG = MERGE_TAGS[0]

const TOKENS: TokenSpec[] = [
  {
    id: FIRST_NAME_TAG.id,
    label: FIRST_NAME_TAG.label,
    text: mergeTagToken(FIRST_NAME_TAG.id, 'email'),
  },
  { id: 'last_name', label: 'Last name', text: EMAIL_MERGE_TAGS[1] },
]

const TONE_LABELS: Record<SocialTone, string> = {
  warm: 'Warm',
  direct: 'Direct',
  urgent: 'Urgent',
  friendly: 'Friendly',
}

type ImageType = (typeof EMAIL_IMAGE_ALLOWED_MIME_TYPES)[number]

const imageType = (file: File): ImageType | undefined =>
  EMAIL_IMAGE_ALLOWED_MIME_TYPES.find((type) => type === file.type)

const ACTIVE_DICTATION: ReadonlySet<DictationStatus> = new Set([
  'requesting_mic',
  'recording',
  'stopping',
])

interface Notice {
  text: string
  previous: EmailComposeState
}

const FieldError = ({ message }: { message: string | undefined }) =>
  message ? <p className="text-xs text-destructive">{message}</p> : null

interface EmailWriteStepProps {
  surface: EmailSurface
  value: EmailComposeState
  onChange: (
    next: EmailComposeState | ((prev: EmailComposeState) => EmailComposeState),
  ) => void
  showIssues: boolean
  goal: string
  // What confirm or the test send refused, shown on its field until the next
  // edit.
  serverError?: ComposeFieldError | null
}

export const EmailWriteStep = ({
  surface,
  value,
  onChange,
  showIssues,
  goal,
  serverError = null,
}: EmailWriteStepProps) => {
  const [tone, setTone] = useState<SocialTone>('warm')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [confirmRegenerate, setConfirmRegenerate] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [imageBusy, setImageBusy] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const latest = useRef(value)
  latest.current = value
  // A draft that lands after the user left this step (Back to the audience)
  // was asked for in a state that may be gone, so it is dropped.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const set = <K extends keyof EmailComposeState>(
    key: K,
    next: EmailComposeState[K],
  ) => {
    setNotice(null)
    onChange({ ...value, [key]: next })
  }

  const messageRef = useRef<TokenFieldRef>(null)
  const dictation = useDictation({
    analyticsLabel: 'outreach-email-compose',
    onFinalTranscript: (text) => {
      if (text) messageRef.current?.insertText(` ${text}`)
    },
  })
  const isRecording = dictation.status === 'recording'
  const dictationBusy = ACTIVE_DICTATION.has(dictation.status) && !isRecording
  const toggleDictation = useCallback(async () => {
    if (ACTIVE_DICTATION.has(dictation.status)) await dictation.stop()
    else await dictation.start()
  }, [dictation])

  const runDraft = async (mode: 'auto' | 'regenerate' | 'improve') => {
    setAiBusy(true)
    setAiError(null)
    setConfirmRegenerate(false)
    const before = latest.current
    try {
      const draft = await draftEmailWithAi(surface.isServe, {
        goal,
        tone,
        layout: before.layout,
        theme: before.theme,
        ...(mode === 'improve' ? { currentDraft: toAiFields(before) } : {}),
      })
      if (!mounted.current) return
      const current = latest.current
      if (mode === 'auto') {
        if (hasNoWriting(current)) {
          onChange(fillFromAiDraft(current, draft.content))
        }
        return
      }
      if (mode === 'improve' && snapshot(current) !== snapshot(before)) {
        setAiError(
          'You changed the email while it was being improved, so yours is unchanged.',
        )
        return
      }
      onChange(
        mode === 'improve'
          ? applyImprovedDraft(current, draft)
          : fillFromAiDraft(current, draft.content),
      )
      setNotice({
        text:
          mode === 'improve'
            ? 'Your email was improved with AI.'
            : 'Your email was replaced with a new draft.',
        previous: current,
      })
    } catch (e) {
      setAiError(apiErrorMessage(e))
    } finally {
      setAiBusy(false)
    }
  }

  const autoDraftedRef = useRef(false)
  useEffect(() => {
    if (autoDraftedRef.current || !goal) return
    autoDraftedRef.current = true
    if (!isUntouched(value)) return
    void runDraft('auto')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const regenerate = () => {
    const edited = !hasNoWriting(value) && snapshot(value) !== value.pristine
    if (edited) setConfirmRegenerate(true)
    else void runDraft('regenerate')
  }

  const pickImage = async (file: File | undefined) => {
    if (!file) return
    const type = imageType(file)
    if (!type) {
      setImageError('Use a JPG, PNG or GIF.')
      return
    }
    if (file.size > EMAIL_IMAGE_MAX_BYTES) {
      setImageError(
        `Use an image under ${EMAIL_IMAGE_MAX_BYTES / 1_000_000} MB.`,
      )
      return
    }
    setImageBusy(true)
    setImageError(null)
    try {
      const photoUrl = await uploadEmailImage(surface.isServe, file, type)
      // An upload that lands after this step closed would reach the send with
      // no description, so it is dropped.
      if (!mounted.current) return
      setNotice(null)
      onChange((prev) => ({ ...prev, photoUrl }))
    } catch (e) {
      setImageError(apiErrorMessage(e))
    } finally {
      setImageBusy(false)
    }
  }

  const issues = writeStepIssues(value, showIssues)
  const errorFor = (field: ComposeField): string | undefined =>
    serverError?.field === field ? serverError.message : issues[field]
  const hasText = !hasNoWriting(value)
  const aiFields = toAiFields(value)
  // The draft endpoint polishes a subject and some body text, so Improve
  // waits for both.
  const canImprove =
    aiFields.subject !== '' &&
    aiFields.body !== '' &&
    aiFields.body.length <= EMAIL_BODY_MAX_LENGTH

  return (
    <div className="space-y-6">
      <Intro title={surface.compose.title} body={surface.compose.caption} />

      <div className="space-y-3" data-testid="email-ai-draft">
        <FilterPillGroup
          type="single"
          value={tone}
          aria-label="Tone"
          onValueChange={(next) => next && setTone(next as SocialTone)}
        >
          {SOCIAL_TONE_VALUES.map((t) => (
            <FilterPill key={t} value={t}>
              {TONE_LABELS[t]}
            </FilterPill>
          ))}
        </FilterPillGroup>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="small"
            variant="outline"
            loading={aiBusy}
            disabled={!goal}
            onClick={regenerate}
          >
            {hasText ? 'Regenerate' : 'Draft it with AI'}
          </Button>
          {hasText && (
            <Button
              type="button"
              size="small"
              variant="outline"
              loading={aiBusy}
              disabled={!goal || !canImprove}
              onClick={() => {
                void runDraft('improve')
              }}
            >
              Improve with AI
            </Button>
          )}
        </div>
        {confirmRegenerate && (
          <Alert data-testid="email-regenerate-confirm">
            <AlertDescription>
              Replace your email with a new draft? Your changes will be lost.
            </AlertDescription>
            <AlertAction className="flex gap-2">
              <Button
                type="button"
                size="small"
                onClick={() => {
                  void runDraft('regenerate')
                }}
              >
                Replace
              </Button>
              <Button
                type="button"
                size="small"
                variant="ghost"
                onClick={() => setConfirmRegenerate(false)}
              >
                Keep mine
              </Button>
            </AlertAction>
          </Alert>
        )}
        {aiError && <p className="text-xs text-destructive">{aiError}</p>}
      </div>

      {notice && (
        <Alert data-testid="email-change-notice">
          <AlertDescription>{notice.text}</AlertDescription>
          <AlertAction>
            <Button
              type="button"
              size="small"
              variant="outline"
              onClick={() => {
                onChange(notice.previous)
                setNotice(null)
              }}
            >
              Undo
            </Button>
          </AlertAction>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="email-subject">Subject</Label>
        <Input
          id="email-subject"
          value={value.subject}
          maxLength={EMAIL_SUBJECT_MAX_LENGTH}
          aria-invalid={Boolean(errorFor('subject'))}
          onChange={(e) => set('subject', e.target.value)}
        />
        <FieldError message={errorFor('subject')} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email-title">Title</Label>
        <Input
          id="email-title"
          value={value.title}
          maxLength={EMAIL_HEADING_MAX_LENGTH}
          aria-invalid={Boolean(errorFor('title'))}
          onChange={(e) => set('title', e.target.value)}
        />
        <FieldError message={errorFor('title')} />
      </div>

      <div className="space-y-2">
        <span className="text-sm font-medium text-foreground">Message</span>
        <Card className={cn(seamlessFieldHost, 'p-4')}>
          <TokenField
            ref={messageRef}
            value={value.message}
            onChange={(next) => set('message', next)}
            tokens={TOKENS}
            maxLength={EMAIL_CONTENT_TEXT_MAX_LENGTH}
            placeholder="Write your message…"
            aria-label="Message"
            aria-invalid={Boolean(errorFor('message'))}
            variant="seamless"
            className="min-h-[200px]"
          />
          <div className="-mx-4 -mb-4 mt-4 flex items-center justify-end gap-1 border-t border-border p-2">
            {TOKENS.map((token) => (
              <Button
                key={token.id}
                type="button"
                size="small"
                variant="ghost"
                onClick={() => messageRef.current?.insertToken(token.id)}
              >
                {token.label}
              </Button>
            ))}
            <IconButton
              type="button"
              variant={isRecording ? 'destructive' : 'ghost'}
              size="small"
              aria-label={isRecording ? 'Stop dictation' : 'Dictate message'}
              disabled={dictation.status === 'stopping'}
              onClick={() => {
                void toggleDictation()
              }}
              className={cn(!isRecording && 'text-muted-foreground')}
            >
              {dictationBusy ? (
                <Loader2Icon className="size-4 animate-spin" aria-hidden />
              ) : isRecording ? (
                <SquareIcon className="size-4 fill-current" aria-hidden />
              ) : (
                <MicIcon className="size-5" aria-hidden />
              )}
            </IconButton>
          </div>
        </Card>
        <p className="text-xs text-muted-foreground">
          Start a line with ## to add a subheading.
        </p>
        <FieldError message={errorFor('message')} />
        {dictation.status === 'error' && dictation.error !== null && (
          <p className="text-xs text-destructive">
            Dictation didn&apos;t start: {dictation.error}. Check your
            microphone permission and try again.
          </p>
        )}
      </div>

      <div className="space-y-2" data-testid="email-photo">
        <Label htmlFor="email-photo-file">Photo (optional)</Label>
        <HiddenFileUploadInput
          ref={photoInputRef}
          id="email-photo-file"
          accept={EMAIL_IMAGE_ALLOWED_MIME_TYPES.join(',')}
          disabled={imageBusy}
          onChange={(file) => {
            if (photoInputRef.current) photoInputRef.current.value = ''
            void pickImage(file)
          }}
        />
        {value.photoUrl ? (
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- the
                upload's S3 host is not in next.config's image domains */}
            <img
              src={value.photoUrl}
              alt="Photo preview"
              className="size-16 rounded-md border border-border object-cover"
            />
            <p className="text-xs text-muted-foreground">Photo added.</p>
            <Button
              type="button"
              size="small"
              variant="outline"
              loading={imageBusy}
              onClick={() => photoInputRef.current?.click()}
            >
              Replace photo
            </Button>
            <Button
              type="button"
              size="small"
              variant="ghost"
              disabled={imageBusy}
              onClick={() => set('photoUrl', '')}
            >
              Remove photo
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            size="small"
            variant="outline"
            loading={imageBusy}
            onClick={() => photoInputRef.current?.click()}
          >
            Add a photo
          </Button>
        )}
        {imageError && <p className="text-xs text-destructive">{imageError}</p>}
        <FieldError message={errorFor('photo')} />
      </div>

      <div className="space-y-2">
        <Button
          type="button"
          size="small"
          variant="outline"
          aria-expanded={previewOpen}
          aria-controls="email-write-preview"
          onClick={() => setPreviewOpen((open) => !open)}
        >
          Preview
        </Button>
        {previewOpen && (
          <div id="email-write-preview">
            <EmailPreview serve={surface.isServe} content={toContent(value)} />
          </div>
        )}
      </div>
    </div>
  )
}
