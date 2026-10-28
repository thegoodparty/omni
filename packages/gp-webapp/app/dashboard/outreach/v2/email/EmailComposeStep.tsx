import { useCallback, useRef } from 'react'
import {
  EMAIL_BODY_MAX_LENGTH,
  EMAIL_BUTTON_LABEL_MAX_LENGTH,
  EMAIL_HEADLINE_MAX_LENGTH,
  EMAIL_LAYOUTS,
  EMAIL_SUBJECT_MAX_LENGTH,
  EMAIL_THEMES,
  EmailLayoutKeySchema,
  EmailThemeKeySchema,
  MERGE_TAGS,
  mergeTagToken,
  type EmailLayoutKey,
  type EmailThemeKey,
} from '@goodparty_org/contracts'
import {
  Button,
  Card,
  cn,
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
import { EmailComingSoon } from './EmailComingSoon'
import { EmailPreview } from './EmailPreview'
import type { ComposeIssues, EmailComposeState } from './emailFlow.util'
import type { EmailSurface } from './emailSurface'

const FIRST_NAME_TAG = MERGE_TAGS[0]

const ACTIVE_DICTATION: ReadonlySet<DictationStatus> = new Set([
  'requesting_mic',
  'recording',
  'stopping',
])

interface EmailComposeStepProps {
  surface: EmailSurface
  value: EmailComposeState
  onChange: (next: EmailComposeState) => void
  issues: ComposeIssues
  showIssues: boolean
  senderName: string
}

export const EmailComposeStep = ({
  surface,
  value,
  onChange,
  issues,
  showIssues,
  senderName,
}: EmailComposeStepProps) => {
  const fieldRef = useRef<TokenFieldRef>(null)
  const set = <K extends keyof EmailComposeState>(
    key: K,
    next: EmailComposeState[K],
  ) => onChange({ ...value, [key]: next })

  const dictation = useDictation({
    analyticsLabel: 'outreach-email-compose',
    onFinalTranscript: (text) => {
      if (text) fieldRef.current?.insertText(` ${text}`)
    },
  })
  const isRecording = dictation.status === 'recording'
  const dictationBusy = ACTIVE_DICTATION.has(dictation.status) && !isRecording
  const toggleDictation = useCallback(async () => {
    if (ACTIVE_DICTATION.has(dictation.status)) await dictation.stop()
    else await dictation.start()
  }, [dictation])

  const tokens: TokenSpec[] = [
    {
      id: FIRST_NAME_TAG.id,
      label: FIRST_NAME_TAG.label,
      text: mergeTagToken(FIRST_NAME_TAG.id, 'email'),
    },
  ]

  const pickLayout = (layout: EmailLayoutKey) =>
    onChange({
      ...value,
      layout,
      theme: EMAIL_LAYOUTS[layout].defaultTheme,
    })

  return (
    <div className="space-y-6">
      <Intro title={surface.compose.title} body={surface.compose.caption} />

      <EmailComingSoon feature="ai-draft" label="Draft it with AI" />

      <div className="space-y-2">
        <Label htmlFor="email-subject">Subject</Label>
        <Input
          id="email-subject"
          value={value.subject}
          maxLength={EMAIL_SUBJECT_MAX_LENGTH}
          aria-invalid={showIssues && Boolean(issues.subject)}
          onChange={(e) => set('subject', e.target.value)}
        />
        {showIssues && issues.subject && (
          <p className="text-xs text-destructive">{issues.subject}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="email-headline">Headline (optional)</Label>
        <Input
          id="email-headline"
          value={value.headline}
          maxLength={EMAIL_HEADLINE_MAX_LENGTH}
          onChange={(e) => set('headline', e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <span className="text-sm font-medium text-foreground">
          Your message
        </span>
        <Card className={cn(seamlessFieldHost, 'p-4')}>
          <TokenField
            ref={fieldRef}
            value={value.body}
            onChange={(next) => set('body', next)}
            tokens={tokens}
            maxLength={EMAIL_BODY_MAX_LENGTH}
            placeholder="Write your message…"
            aria-label="Message body"
            aria-invalid={showIssues && Boolean(issues.body)}
            variant="seamless"
            className="min-h-[160px]"
          />
          <div className="-mx-4 -mb-4 mt-4 flex items-center justify-end gap-1 border-t border-border p-2">
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
        {showIssues && issues.body && (
          <p className="text-xs text-destructive">{issues.body}</p>
        )}
        {dictation.status === 'error' && dictation.error !== null && (
          <p className="text-xs text-destructive">
            Dictation didn&apos;t start: {dictation.error}. Check your
            microphone permission and try again.
          </p>
        )}
      </div>

      <EmailComingSoon feature="image" label="Add an image" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="email-button-label">Button label (optional)</Label>
          <Input
            id="email-button-label"
            value={value.buttonLabel}
            maxLength={EMAIL_BUTTON_LABEL_MAX_LENGTH}
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
            onChange={(e) => set('buttonUrl', e.target.value)}
          />
        </div>
      </div>
      {showIssues && issues.button && (
        <p className="text-xs text-destructive">{issues.button}</p>
      )}

      <div className="space-y-3">
        <span className="text-sm font-medium text-foreground">Layout</span>
        <div className="flex flex-wrap gap-2">
          {EmailLayoutKeySchema.options.map((key) => (
            <Button
              key={key}
              type="button"
              size="small"
              variant={value.layout === key ? 'default' : 'outline'}
              aria-pressed={value.layout === key}
              onClick={() => pickLayout(key)}
            >
              {EMAIL_LAYOUTS[key].label}
            </Button>
          ))}
        </div>
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

      <div className="space-y-2">
        <span className="text-sm font-medium text-foreground">Preview</span>
        <EmailPreview
          layout={value.layout}
          theme={value.theme}
          senderName={senderName}
          headline={value.headline}
          body={value.body}
          buttonLabel={value.buttonLabel}
          buttonUrl={value.buttonUrl}
        />
      </div>
    </div>
  )
}
