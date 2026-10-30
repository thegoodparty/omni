import { useCallback, useEffect, useRef, useState } from 'react'
import {
  EMAIL_BLOCK_BUTTON_LABEL_MAX_LENGTH,
  EMAIL_BODY_MAX_LENGTH,
  EMAIL_CONTENT_TEXT_MAX_LENGTH,
  EMAIL_HEADING_MAX_LENGTH,
  EMAIL_IMAGE_ALLOWED_MIME_TYPES,
  EMAIL_IMAGE_MAX_BYTES,
  EMAIL_LAYOUT_PRESETS,
  EMAIL_MERGE_TAGS,
  EMAIL_SUBJECT_MAX_LENGTH,
  EMAIL_THEMES,
  EMAIL_URL_MAX_LENGTH,
  EmailLayoutPresetKeySchema,
  EmailThemeKeySchema,
  MERGE_TAGS,
  mergeTagToken,
  SOCIAL_TONE_VALUES,
  type EmailLayoutPresetKey,
  type EmailThemeKey,
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
import { Intro } from '../social/Intro'
import { EmailPreview } from './EmailPreview'
import { apiErrorMessage, draftEmailWithAi, uploadEmailImage } from './emailApi'
import {
  applyImprovedDraft,
  composeIssues,
  fillFromAiDraft,
  hasNoWriting,
  isUntouched,
  needsButton,
  snapshot,
  switchLayout,
  toAiFields,
  toContent,
  usesSubheadings,
  usesTitle,
  type ComposeField,
  type ComposeFieldError,
  type EmailComposeState,
  type PhotoPosition,
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

const PHOTO_POSITIONS: { value: PhotoPosition; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
]

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

interface EmailComposeStepProps {
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

export const EmailComposeStep = ({
  surface,
  value,
  onChange,
  showIssues,
  goal,
  serverError = null,
}: EmailComposeStepProps) => {
  const [tone, setTone] = useState<SocialTone>('warm')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [confirmRegenerate, setConfirmRegenerate] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [imageBusy, setImageBusy] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const latest = useRef(value)
  latest.current = value
  // A draft that lands after the user left compose (Back to the goal) was
  // for the old goal, so it is dropped.
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
      // An upload that lands after compose closed would reach the send with
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

  const pickLayout = (layout: EmailLayoutPresetKey) => {
    if (layout === value.layout) return
    setNotice(null)
    onChange(switchLayout(value, layout))
  }

  const issues = composeIssues(value, showIssues)
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
  const buttonRequired = needsButton(value.layout)

  return (
    <div className="space-y-6">
      <Intro title={surface.compose.title} body={surface.compose.caption} />

      <div className="space-y-2">
        <span className="block text-sm font-medium text-foreground">
          Layout
        </span>
        <FilterPillGroup
          type="single"
          value={value.layout}
          aria-label="Layout"
          onValueChange={(next) => {
            const parsed = EmailLayoutPresetKeySchema.safeParse(next)
            if (parsed.success) pickLayout(parsed.data)
          }}
        >
          {EmailLayoutPresetKeySchema.options.map((key) => (
            <FilterPill key={key} value={key}>
              {EMAIL_LAYOUT_PRESETS[key].label}
            </FilterPill>
          ))}
        </FilterPillGroup>
        <p className="text-sm text-muted-foreground">
          {EMAIL_LAYOUT_PRESETS[value.layout].description}
        </p>
      </div>

      <div className="space-y-3">
        <span className="block text-sm font-medium text-foreground">
          Colors
        </span>
        <div className="flex flex-wrap gap-3">
          {EmailThemeKeySchema.options.map((key: EmailThemeKey) => (
            <button
              key={key}
              type="button"
              aria-label={EMAIL_THEMES[key].label}
              aria-pressed={value.theme === key}
              title={EMAIL_THEMES[key].label}
              onClick={() => set('theme', key)}
              className={cn(
                'size-9 rounded-full border-2',
                value.theme === key ? 'border-primary' : 'border-border',
              )}
              style={{ backgroundColor: EMAIL_THEMES[key].colors.header }}
            />
          ))}
        </div>
      </div>

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

      {usesTitle(value.layout) && (
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
      )}

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
        {usesSubheadings(value.layout) && (
          <p className="text-xs text-muted-foreground">
            Start a line with ## to add a subheading.
          </p>
        )}
        <FieldError message={errorFor('message')} />
        {dictation.status === 'error' && dictation.error !== null && (
          <p className="text-xs text-destructive">
            Dictation didn&apos;t start: {dictation.error}. Check your
            microphone permission and try again.
          </p>
        )}
      </div>

      <div className="space-y-2" data-testid="email-photo">
        <Label htmlFor="email-photo-file">
          {value.photoUrl ? 'Replace the photo' : 'Photo (optional)'}
        </Label>
        <Input
          id="email-photo-file"
          type="file"
          accept={EMAIL_IMAGE_ALLOWED_MIME_TYPES.join(',')}
          disabled={imageBusy}
          onChange={(e) => {
            void pickImage(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        {imageError && <p className="text-xs text-destructive">{imageError}</p>}
        {value.photoUrl && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground">Photo added.</p>
              <Button
                type="button"
                size="small"
                variant="ghost"
                onClick={() => set('photoUrl', '')}
              >
                Remove photo
              </Button>
            </div>
            {value.layout === 'personal_letter' && (
              <FilterPillGroup
                type="single"
                value={value.photoPosition}
                aria-label="Photo position"
                onValueChange={(next) => {
                  const position = PHOTO_POSITIONS.find((p) => p.value === next)
                  if (position) set('photoPosition', position.value)
                }}
              >
                {PHOTO_POSITIONS.map((position) => (
                  <FilterPill key={position.value} value={position.value}>
                    {position.label}
                  </FilterPill>
                ))}
              </FilterPillGroup>
            )}
          </div>
        )}
        <FieldError message={errorFor('photo')} />
      </div>

      <div className="space-y-2" data-testid="email-button">
        <span className="block text-sm font-medium text-foreground">
          {buttonRequired ? 'Button' : 'Button (optional)'}
        </span>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="email-button-label">Button text</Label>
            <Input
              id="email-button-label"
              value={value.buttonLabel}
              maxLength={EMAIL_BLOCK_BUTTON_LABEL_MAX_LENGTH}
              onChange={(e) => set('buttonLabel', e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email-button-url">Button link</Label>
            <Input
              id="email-button-url"
              type="url"
              placeholder="https://"
              value={value.buttonUrl}
              maxLength={EMAIL_URL_MAX_LENGTH}
              onChange={(e) => set('buttonUrl', e.target.value)}
            />
            {!value.buttonUrl.trim() && !errorFor('button') && (
              <p className="text-xs text-muted-foreground">
                {surface.compose.buttonLinkHint}
              </p>
            )}
          </div>
        </div>
        {value.buttonLabel.trim() && !value.buttonUrl.trim() && !showIssues && (
          <p
            className="text-sm text-foreground"
            data-testid="email-link-prompt"
          >
            Add a link to your button before you continue.
          </p>
        )}
        <FieldError message={errorFor('button')} />
      </div>

      <div className="space-y-2">
        <span className="text-sm font-medium text-foreground">Preview</span>
        <EmailPreview serve={surface.isServe} content={toContent(value)} />
      </div>
    </div>
  )
}
