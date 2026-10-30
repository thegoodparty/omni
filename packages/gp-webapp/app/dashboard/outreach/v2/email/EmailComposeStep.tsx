import { useCallback, useEffect, useRef, useState } from 'react'
import {
  EMAIL_IMAGE_ALLOWED_MIME_TYPES,
  EMAIL_IMAGE_MAX_BYTES,
  EMAIL_LAYOUT_PRESETS,
  EMAIL_SUBJECT_MAX_LENGTH,
  EMAIL_THEMES,
  EmailLayoutPresetKeySchema,
  EmailThemeKeySchema,
  SOCIAL_TONE_VALUES,
  type EmailBlockDraft,
  type EmailLayoutPresetKey,
  type EmailThemeKey,
  type SocialTone,
} from '@goodparty_org/contracts'
import {
  Alert,
  AlertAction,
  AlertDescription,
  Button,
  cn,
  FilterPill,
  FilterPillGroup,
  Input,
  Label,
  type TokenFieldRef,
} from '@styleguide'
import { PlusIcon } from '@styleguide/components/ui/icons'
import {
  type DictationStatus,
  useDictation,
} from 'app/dashboard/shared/dictation/useDictation'
import { Intro } from '../social/Intro'
import { EmailBlockCard, blockLabel } from './EmailBlockCard'
import { EmailPreview } from './EmailPreview'
import { apiErrorMessage, draftEmailWithAi, uploadEmailImage } from './emailApi'
import {
  addBlock,
  addableKinds,
  applyImprovedDraft,
  canMove,
  canRemove,
  editorIssues,
  fillFromAiDraft,
  isUntouched,
  moveBlock,
  switchLayout,
  toAiFields,
  toContent,
  type AddableKind,
  type BlockError,
  type EmailComposeState,
} from './emailBlocks.util'
import type { EmailSurface } from './emailSurface'

const TONE_LABELS: Record<SocialTone, string> = {
  warm: 'Warm',
  direct: 'Direct',
  urgent: 'Urgent',
  friendly: 'Friendly',
}

const ADD_LABELS: Record<AddableKind, string> = {
  headline: 'Headline',
  subheading: 'Subheading',
  paragraph: 'Paragraph',
  image: 'Photo',
  button: 'Button',
  divider: 'Divider',
}

type ImageType = (typeof EMAIL_IMAGE_ALLOWED_MIME_TYPES)[number]

const imageType = (file: File): ImageType | undefined =>
  EMAIL_IMAGE_ALLOWED_MIME_TYPES.find((type) => type === file.type)

const ACTIVE_DICTATION: ReadonlySet<DictationStatus> = new Set([
  'requesting_mic',
  'recording',
  'stopping',
])

const snapshot = (state: EmailComposeState): string =>
  JSON.stringify(toContent(state))

interface Notice {
  text: string
  previous: EmailComposeState
}

interface EmailComposeStepProps {
  surface: EmailSurface
  value: EmailComposeState
  onChange: (
    next: EmailComposeState | ((prev: EmailComposeState) => EmailComposeState),
  ) => void
  showIssues: boolean
  goal: string
  // A block confirm or the test send refused, shown on its card until the
  // next edit.
  serverError?: BlockError | null
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
  const [imageBusyId, setImageBusyId] = useState<string | null>(null)
  const [imageError, setImageError] = useState<{
    id: string
    message: string
  } | null>(null)
  const latest = useRef(value)
  latest.current = value
  // The content as the starter blocks or the last AI draft left it, so
  // Regenerate knows whether it would throw away the user's own edits.
  // Content already written when compose opens is the user's own.
  const pristine = useRef(isUntouched(value) ? snapshot(value) : null)

  const edit = (next: EmailComposeState) => {
    setNotice(null)
    onChange(next)
  }

  const setBlock = (index: number, block: EmailBlockDraft) =>
    edit({
      ...value,
      blocks: value.blocks.map((entry, i) =>
        i === index ? { ...entry, block } : entry,
      ),
    })

  const fields = useRef(new Map<string, TokenFieldRef>())
  const [dictatingId, setDictatingId] = useState<string | null>(null)
  const dictatingRef = useRef<string | null>(null)
  dictatingRef.current = dictatingId
  const dictation = useDictation({
    analyticsLabel: 'outreach-email-compose',
    onFinalTranscript: (text) => {
      const target = dictatingRef.current
      if (text && target) fields.current.get(target)?.insertText(` ${text}`)
    },
  })
  const dictationActive = ACTIVE_DICTATION.has(dictation.status)
  const toggleDictation = useCallback(
    async (id: string) => {
      if (ACTIVE_DICTATION.has(dictation.status)) {
        await dictation.stop()
        return
      }
      setDictatingId(id)
      await dictation.start()
    },
    [dictation],
  )

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
      const current = latest.current
      if (mode === 'auto') {
        if (!isUntouched(current)) return
        const next = fillFromAiDraft(current, draft.content)
        pristine.current = snapshot(next)
        onChange(next)
        return
      }
      const next =
        mode === 'improve'
          ? applyImprovedDraft(current, draft)
          : fillFromAiDraft(current, draft.content)
      pristine.current = snapshot(next)
      onChange(next)
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
    const edited = !isUntouched(value) && snapshot(value) !== pristine.current
    if (edited) setConfirmRegenerate(true)
    else void runDraft('regenerate')
  }

  const pickImage = async (id: string, file: File | undefined) => {
    if (!file) return
    const type = imageType(file)
    if (!type) {
      setImageError({ id, message: 'Use a JPG, PNG or GIF.' })
      return
    }
    if (file.size > EMAIL_IMAGE_MAX_BYTES) {
      setImageError({
        id,
        message: `Use an image under ${EMAIL_IMAGE_MAX_BYTES / 1_000_000} MB.`,
      })
      return
    }
    setImageBusyId(id)
    setImageError(null)
    try {
      const url = await uploadEmailImage(surface.isServe, file, type)
      setNotice(null)
      onChange((prev) => ({
        ...prev,
        blocks: prev.blocks.map((entry) =>
          entry.id === id && entry.block.type === 'image'
            ? { ...entry, block: { ...entry.block, url } }
            : entry,
        ),
      }))
    } catch (e) {
      setImageError({ id, message: apiErrorMessage(e) })
    } finally {
      setImageBusyId(null)
    }
  }

  const pickLayout = (layout: EmailLayoutPresetKey) => {
    if (layout === value.layout) return
    const { state, changes } = switchLayout(value, layout)
    if (isUntouched(value)) pristine.current = snapshot(state)
    onChange(state)
    setNotice(
      changes.length > 0
        ? {
            text: `Switched to ${EMAIL_LAYOUT_PRESETS[layout].label}. ${changes.join(' ')}`,
            previous: value,
          }
        : null,
    )
  }

  const issues = editorIssues(value, showIssues)
  const hasText = !isUntouched(value)
  const aiFields = toAiFields(value)
  // The draft endpoint polishes a subject and some body text, so Improve
  // waits for both.
  const canImprove = aiFields.subject !== '' && aiFields.body !== ''
  const kinds = addableKinds(value.layout, value.blocks)
  const labels = value.blocks.map(({ block }) => blockLabel(block))
  const titles = labels.map((label, i) => {
    const same = labels.filter((l) => l === label).length
    const ordinal = labels.slice(0, i + 1).filter((l) => l === label).length
    return same > 1 ? `${label} ${ordinal}` : label
  })
  const emptyButtonLink = value.blocks.some(
    ({ block }) => block.type === 'button' && !block.url.trim(),
  )

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
          aria-invalid={Boolean(issues.subject)}
          onChange={(e) => edit({ ...value, subject: e.target.value })}
        />
        {issues.subject && (
          <p className="text-xs text-destructive">{issues.subject}</p>
        )}
      </div>

      {emptyButtonLink && !showIssues && (
        <p className="text-sm text-foreground" data-testid="email-link-prompt">
          Add a link to your button before you continue.
        </p>
      )}

      <div className="space-y-3" data-testid="email-blocks">
        {value.blocks.map((entry, index) => {
          const cardIssues = [
            ...(serverError?.index === index ? [serverError.message] : []),
            ...(issues.blocks[index] ?? []),
          ]
          const isDictating = dictatingId === entry.id
          return (
            <EmailBlockCard
              key={entry.id}
              id={entry.id}
              title={titles[index] ?? labels[index] ?? ''}
              block={entry.block}
              issues={cardIssues}
              buttonLinkHint={surface.compose.buttonLinkHint}
              canMoveUp={canMove(value.layout, value.blocks, index, -1)}
              canMoveDown={canMove(value.layout, value.blocks, index, 1)}
              canRemove={canRemove(value.layout, value.blocks, index)}
              onChange={(block) => setBlock(index, block)}
              onMove={(direction) =>
                edit({
                  ...value,
                  blocks: moveBlock(value.blocks, index, direction),
                })
              }
              onRemove={() =>
                edit({
                  ...value,
                  blocks: value.blocks.filter((_, i) => i !== index),
                })
              }
              onPickImage={(file) => {
                void pickImage(entry.id, file)
              }}
              imageBusy={imageBusyId === entry.id}
              imageError={
                imageError?.id === entry.id ? imageError.message : null
              }
              dictation={{
                recording: isDictating && dictation.status === 'recording',
                busy:
                  isDictating &&
                  dictationActive &&
                  dictation.status !== 'recording',
                disabled:
                  dictation.status === 'stopping' ||
                  (dictationActive && !isDictating),
                onToggle: () => {
                  void toggleDictation(entry.id)
                },
              }}
              fieldRef={(ref) => {
                if (ref) fields.current.set(entry.id, ref)
                else fields.current.delete(entry.id)
              }}
            />
          )
        })}
        {issues.email.map((issue) => (
          <p key={issue} className="text-xs text-destructive">
            {issue}
          </p>
        ))}
        {dictation.status === 'error' && dictation.error !== null && (
          <p className="text-xs text-destructive">
            Dictation didn&apos;t start: {dictation.error}. Check your
            microphone permission and try again.
          </p>
        )}
      </div>

      {kinds.length > 0 && (
        <div className="space-y-2" data-testid="email-add-block">
          <span className="block text-sm font-medium text-foreground">
            Add a block
          </span>
          <div className="flex flex-wrap gap-2">
            {kinds.map((kind) => (
              <Button
                key={kind}
                type="button"
                size="small"
                variant="outline"
                onClick={() =>
                  edit({
                    ...value,
                    blocks: addBlock(value.layout, value.blocks, kind),
                  })
                }
              >
                <PlusIcon aria-hidden />
                {ADD_LABELS[kind]}
              </Button>
            ))}
          </div>
        </div>
      )}

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
              onClick={() => edit({ ...value, theme: key })}
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
        <EmailPreview serve={surface.isServe} content={toContent(value)} />
      </div>
    </div>
  )
}
