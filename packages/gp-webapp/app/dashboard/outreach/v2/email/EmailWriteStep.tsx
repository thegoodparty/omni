import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TokenField,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  type TokenFieldRef,
  type TokenSpec,
} from '@styleguide'
import {
  CircleAlertIcon,
  EyeIcon,
  ClockIcon,
  Loader2Icon,
  MicIcon,
  PencilIcon,
  PlusIcon,
  RefreshIcon,
  SmileIcon,
  SparklesIcon,
  SquareIcon,
  SunIcon,
  TargetIcon,
} from '@styleguide/components/ui/icons'
import { LengthCounter } from 'app/dashboard/shared/compose/LengthCounter'
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

const TOKEN_HINTS: Record<string, string> = {
  [FIRST_NAME_TAG.id]: 'Adds each person\'s first name, like "Hello Maria"',
  last_name: 'Adds each person\'s last name, like "Dear Ms. Lopez"',
}

const TONE_LABELS: Record<SocialTone, string> = {
  warm: 'Warm',
  direct: 'Direct',
  urgent: 'Urgent',
  friendly: 'Friendly',
}

const TONE_ICONS: Record<SocialTone, ReactNode> = {
  warm: <SunIcon className="size-4" />,
  direct: <TargetIcon className="size-4" />,
  urgent: <ClockIcon className="size-4" />,
  friendly: <SmileIcon className="size-4" />,
}

type ImageType = (typeof EMAIL_IMAGE_ALLOWED_MIME_TYPES)[number]

const imageType = (file: File): ImageType | undefined =>
  EMAIL_IMAGE_ALLOWED_MIME_TYPES.find((type) => type === file.type)

const ACTIVE_DICTATION: ReadonlySet<DictationStatus> = new Set([
  'requesting_mic',
  'recording',
  'stopping',
])

type AiMode = 'auto' | 'regenerate' | 'improve'

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
  const [aiMode, setAiMode] = useState<AiMode | null>(null)
  const [aiError, setAiError] = useState<{
    mode: AiMode
    message: string
  } | null>(null)
  const [confirmRegenerate, setConfirmRegenerate] = useState(false)
  const [undoTo, setUndoTo] = useState<EmailComposeState | null>(null)
  const [imageBusy, setImageBusy] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const [view, setView] = useState<'write' | 'preview'>('write')
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
    setUndoTo(null)
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

  const runDraft = async (mode: AiMode, withTone: SocialTone = tone) => {
    setAiMode(mode)
    setAiError(null)
    setConfirmRegenerate(false)
    const before = latest.current
    try {
      const draft = await draftEmailWithAi(surface.isServe, {
        goal,
        tone: withTone,
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
        setAiError({
          mode,
          message:
            'You changed the email while it was being improved, so yours is unchanged.',
        })
        return
      }
      onChange(
        mode === 'improve'
          ? applyImprovedDraft(current, draft)
          : fillFromAiDraft(current, draft.content),
      )
      setUndoTo(current)
    } catch {
      setAiError({
        mode,
        message:
          mode === 'improve'
            ? "We couldn't improve your email just now. Try again, or keep editing it yourself."
            : "We couldn't draft your email just now. Try again, or write your own below.",
      })
    } finally {
      setAiMode(null)
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

  // As in the other channels, a tone pick rewrites right away: the author's
  // own words are polished in the new tone, an untouched draft is redrafted.
  const pickTone = (next: SocialTone) => {
    setTone(next)
    if (!goal || aiBusy || hasNoWriting(value)) return
    const edited = snapshot(value) !== value.pristine
    if (!edited) void runDraft('regenerate', next)
    else if (canImprove) void runDraft('improve', next)
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
      setUndoTo(null)
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
  const aiBusy = aiMode !== null
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <FilterPillGroup
            type="single"
            value={tone}
            aria-label="Tone"
            onValueChange={(next) => {
              if (!next || next === tone) return
              pickTone(next as SocialTone)
            }}
          >
            {SOCIAL_TONE_VALUES.map((t) => (
              <FilterPill key={t} value={t} className="gap-1.5">
                {TONE_ICONS[t]}
                {TONE_LABELS[t]}
              </FilterPill>
            ))}
          </FilterPillGroup>
          <Button
            type="button"
            variant="link"
            size="small"
            className="h-auto gap-1.5 px-0 no-underline"
            disabled={!goal || aiBusy}
            onClick={regenerate}
          >
            {aiMode === 'auto' || aiMode === 'regenerate' ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <RefreshIcon className="size-4" />
            )}
            {hasText ? 'Regenerate' : 'Draft it with AI'}
          </Button>
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
        {aiError && (
          <Alert variant="destructive" icon={<CircleAlertIcon />}>
            <AlertDescription>{aiError.message}</AlertDescription>
            <AlertAction>
              <Button
                type="button"
                size="small"
                variant="alertOutline"
                onClick={() => {
                  void runDraft(
                    aiError.mode === 'auto' ? 'regenerate' : aiError.mode,
                  )
                }}
              >
                Try again
              </Button>
            </AlertAction>
          </Alert>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="email-subject">Subject</Label>
        <Input
          id="email-subject"
          value={value.subject}
          maxLength={EMAIL_SUBJECT_MAX_LENGTH}
          aria-invalid={Boolean(errorFor('subject'))}
          onChange={(e) => set('subject', e.target.value)}
        />
        <p className="text-sm text-muted-foreground">Shown in the inbox.</p>
        <LengthCounter
          length={value.subject.length}
          max={EMAIL_SUBJECT_MAX_LENGTH}
        />
        <FieldError message={errorFor('subject')} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email-title">Headline</Label>
        <Input
          id="email-title"
          value={value.title}
          maxLength={EMAIL_HEADING_MAX_LENGTH}
          aria-invalid={Boolean(errorFor('title'))}
          onChange={(e) => set('title', e.target.value)}
        />
        <p className="text-sm text-muted-foreground">
          The big heading at the top of your email.
        </p>
        <LengthCounter
          length={value.title.length}
          max={EMAIL_HEADING_MAX_LENGTH}
        />
        <FieldError message={errorFor('title')} />
      </div>

      <Tabs
        value={view}
        onValueChange={(next) =>
          setView(next === 'preview' ? 'preview' : 'write')
        }
        className="gap-2"
      >
        <div className="flex items-end justify-between gap-2">
          <span className="text-sm font-medium text-foreground">Message</span>
          <TabsList aria-label="Message view">
            <TabsTrigger value="write">
              <PencilIcon aria-hidden />
              Write
            </TabsTrigger>
            <TabsTrigger value="preview">
              <EyeIcon aria-hidden />
              Preview
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="write" className="space-y-2">
          <Card className={cn(seamlessFieldHost, 'p-4')}>
            <div className="-mx-4 -mt-4 mb-4 flex flex-wrap items-center justify-between gap-1 border-b border-border p-2">
              <div className="flex gap-1">
                {TOKENS.map((token) => (
                  <Tooltip key={token.id}>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        size="small"
                        variant="ghost"
                        className="text-muted-foreground"
                        icon={<PlusIcon aria-hidden />}
                        onClick={() =>
                          messageRef.current?.insertToken(token.id)
                        }
                      >
                        Add {token.label.toLowerCase()}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{TOKEN_HINTS[token.id]}</TooltipContent>
                  </Tooltip>
                ))}
              </div>
              {!value.photoUrl && (
                <span data-testid="email-photo">
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    className="text-muted-foreground"
                    icon={<PlusIcon aria-hidden />}
                    loading={imageBusy}
                    onClick={() => photoInputRef.current?.click()}
                  >
                    Add photo
                  </Button>
                </span>
              )}
            </div>
            <Label htmlFor="email-photo-file" className="sr-only">
              Photo (optional)
            </Label>
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
            {value.photoUrl && (
              <div
                className="mb-4 flex flex-wrap items-center gap-3"
                data-testid="email-photo"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- the
                        upload's S3 host is not in next.config's image domains */}
                <img
                  src={value.photoUrl}
                  alt="Photo preview"
                  className="size-16 rounded-md border border-border object-cover"
                />
                <Button
                  type="button"
                  size="small"
                  variant="ghost"
                  className="text-muted-foreground"
                  loading={imageBusy}
                  onClick={() => photoInputRef.current?.click()}
                >
                  Replace photo
                </Button>
                <Button
                  type="button"
                  size="small"
                  variant="ghost"
                  className="text-muted-foreground"
                  disabled={imageBusy}
                  onClick={() => set('photoUrl', '')}
                >
                  Remove photo
                </Button>
              </div>
            )}
            <TokenField
              ref={messageRef}
              value={value.message}
              onChange={(next) => set('message', next)}
              tokens={TOKENS}
              maxLength={EMAIL_CONTENT_TEXT_MAX_LENGTH}
              // Read-only until the first draft lands, so nothing typed is
              // overwritten by it.
              readOnly={aiMode === 'auto' && !value.message.trim()}
              placeholder={
                aiMode === 'auto' && !value.message.trim()
                  ? 'Drafting your email…'
                  : 'Write your message…'
              }
              aria-label="Message"
              aria-invalid={Boolean(errorFor('message'))}
              variant="seamless"
              className="min-h-[200px]"
            />
            <LengthCounter
              length={value.message.length}
              max={EMAIL_CONTENT_TEXT_MAX_LENGTH}
            />
            <FieldError message={errorFor('message')} />
            {imageError && (
              <p className="text-xs text-destructive">{imageError}</p>
            )}
            <FieldError message={errorFor('photo')} />
            <p className="text-xs text-muted-foreground">
              Start a line with ## to add a subheading.
            </p>
            <div className="-mx-4 -mb-4 mt-4 flex flex-wrap items-center justify-end gap-1 border-t border-border p-2">
              {undoTo && (
                <Button
                  type="button"
                  size="small"
                  variant="link"
                  className="h-auto px-2"
                  onClick={() => {
                    onChange(undoTo)
                    setUndoTo(null)
                  }}
                >
                  Undo
                </Button>
              )}
              {hasText && (
                <Button
                  type="button"
                  size="small"
                  variant="ghost"
                  className="text-muted-foreground"
                  disabled={!goal || !canImprove || aiBusy}
                  onClick={() => {
                    void runDraft('improve')
                  }}
                >
                  {aiMode === 'improve' ? (
                    <>
                      <Loader2Icon className="size-4 animate-spin" />
                      Improving…
                    </>
                  ) : (
                    <>
                      <SparklesIcon className="size-4" />
                      Improve with AI
                    </>
                  )}
                </Button>
              )}
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
          {dictation.status === 'error' && dictation.error !== null && (
            <p className="text-xs text-destructive">
              Dictation didn&apos;t start: {dictation.error}. Check your
              microphone permission and try again.
            </p>
          )}
        </TabsContent>
        <TabsContent value="preview">
          <EmailPreview serve={surface.isServe} content={toContent(value)} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
