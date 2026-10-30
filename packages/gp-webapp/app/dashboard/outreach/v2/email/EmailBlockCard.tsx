import {
  EMAIL_BLOCK_BUTTON_LABEL_MAX_LENGTH,
  EMAIL_HEADING_MAX_LENGTH,
  EMAIL_IMAGE_ALLOWED_MIME_TYPES,
  EMAIL_IMAGE_ALT_MAX_LENGTH,
  EMAIL_PARAGRAPH_MAX_LENGTH,
  EMAIL_URL_MAX_LENGTH,
  MERGE_TAGS,
  mergeTagToken,
  type EmailBlockDraft,
} from '@goodparty_org/contracts'
import {
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
  ChevronDownIcon,
  ChevronUpIcon,
  Loader2Icon,
  MicIcon,
  SquareIcon,
  Trash2Icon,
} from '@styleguide/components/ui/icons'

const FIRST_NAME_TAG = MERGE_TAGS[0]

const TOKENS: TokenSpec[] = [
  {
    id: FIRST_NAME_TAG.id,
    label: FIRST_NAME_TAG.label,
    text: mergeTagToken(FIRST_NAME_TAG.id, 'email'),
  },
]

export const blockLabel = (block: EmailBlockDraft): string => {
  switch (block.type) {
    case 'heading':
      return block.level === 1 ? 'Headline' : 'Subheading'
    case 'paragraph':
      return 'Paragraph'
    case 'image':
      return 'Photo'
    case 'button':
      return 'Button'
    case 'divider':
      return 'Divider'
  }
}

export interface ParagraphDictation {
  recording: boolean
  busy: boolean
  disabled: boolean
  onToggle: () => void
}

interface EmailBlockCardProps {
  id: string
  title: string
  block: EmailBlockDraft
  issues: string[]
  buttonLinkHint: string
  canMoveUp: boolean
  canMoveDown: boolean
  canRemove: boolean
  onChange: (block: EmailBlockDraft) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
  onPickImage: (file: File | undefined) => void
  imageBusy: boolean
  imageError: string | null
  dictation: ParagraphDictation
  fieldRef: (ref: TokenFieldRef | null) => void
}

export const EmailBlockCard = ({
  id,
  title,
  block,
  issues,
  buttonLinkHint,
  canMoveUp,
  canMoveDown,
  canRemove,
  onChange,
  onMove,
  onRemove,
  onPickImage,
  imageBusy,
  imageError,
  dictation,
  fieldRef,
}: EmailBlockCardProps) => {
  const invalid = issues.length > 0
  const field = `email-block-${id}`

  return (
    <Card
      role="group"
      aria-label={title}
      data-testid="email-block"
      data-block-type={block.type}
      className={cn('space-y-3 p-4', invalid && 'border-destructive')}
    >
      <div className="flex items-center justify-between gap-2">
        {block.type === 'heading' ? (
          <Label htmlFor={field}>{title}</Label>
        ) : (
          <span className="text-sm font-medium text-foreground">{title}</span>
        )}
        <div className="flex items-center gap-1">
          <IconButton
            type="button"
            variant="ghost"
            size="small"
            aria-label={`Move ${title.toLowerCase()} up`}
            disabled={!canMoveUp}
            onClick={() => onMove(-1)}
          >
            <ChevronUpIcon aria-hidden />
          </IconButton>
          <IconButton
            type="button"
            variant="ghost"
            size="small"
            aria-label={`Move ${title.toLowerCase()} down`}
            disabled={!canMoveDown}
            onClick={() => onMove(1)}
          >
            <ChevronDownIcon aria-hidden />
          </IconButton>
          <IconButton
            type="button"
            variant="ghost"
            size="small"
            aria-label={`Remove ${title.toLowerCase()}`}
            disabled={!canRemove}
            onClick={onRemove}
          >
            <Trash2Icon aria-hidden />
          </IconButton>
        </div>
      </div>

      {block.type === 'heading' && (
        <Input
          id={field}
          value={block.text}
          maxLength={EMAIL_HEADING_MAX_LENGTH}
          aria-invalid={invalid}
          onChange={(e) => onChange({ ...block, text: e.target.value })}
        />
      )}

      {block.type === 'paragraph' && (
        <div
          className={cn(seamlessFieldHost, 'rounded-md border border-border')}
        >
          <TokenField
            ref={fieldRef}
            value={block.text}
            onChange={(text) => onChange({ ...block, text })}
            tokens={TOKENS}
            maxLength={EMAIL_PARAGRAPH_MAX_LENGTH}
            placeholder="Write a few sentences…"
            aria-label={title}
            aria-invalid={invalid}
            variant="seamless"
            className="min-h-[96px] px-3 py-2"
          />
          <div className="flex justify-end border-t border-border p-1">
            <IconButton
              type="button"
              variant={dictation.recording ? 'destructive' : 'ghost'}
              size="small"
              aria-label={
                dictation.recording
                  ? 'Stop dictation'
                  : `Dictate ${title.toLowerCase()}`
              }
              disabled={dictation.disabled}
              onClick={dictation.onToggle}
              className={cn(!dictation.recording && 'text-muted-foreground')}
            >
              {dictation.busy ? (
                <Loader2Icon className="size-4 animate-spin" aria-hidden />
              ) : dictation.recording ? (
                <SquareIcon className="size-4 fill-current" aria-hidden />
              ) : (
                <MicIcon className="size-5" aria-hidden />
              )}
            </IconButton>
          </div>
        </div>
      )}

      {block.type === 'image' && (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor={`${field}-file`}>
              {block.url ? 'Replace the photo' : 'Upload a photo'}
            </Label>
            <Input
              id={`${field}-file`}
              type="file"
              accept={EMAIL_IMAGE_ALLOWED_MIME_TYPES.join(',')}
              disabled={imageBusy}
              onChange={(e) => {
                onPickImage(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            {block.url && (
              <p className="text-xs text-muted-foreground">Photo added.</p>
            )}
            {imageError && (
              <p className="text-xs text-destructive">{imageError}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${field}-alt`}>What the photo shows</Label>
            <Input
              id={`${field}-alt`}
              value={block.alt}
              maxLength={EMAIL_IMAGE_ALT_MAX_LENGTH}
              placeholder="Volunteers cleaning up Riverside Park"
              onChange={(e) => onChange({ ...block, alt: e.target.value })}
            />
          </div>
        </div>
      )}

      {block.type === 'button' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${field}-label`}>Button text</Label>
            <Input
              id={`${field}-label`}
              value={block.label}
              maxLength={EMAIL_BLOCK_BUTTON_LABEL_MAX_LENGTH}
              onChange={(e) => onChange({ ...block, label: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${field}-url`}>Button link</Label>
            <Input
              id={`${field}-url`}
              type="url"
              placeholder="https://"
              value={block.url}
              maxLength={EMAIL_URL_MAX_LENGTH}
              onChange={(e) => onChange({ ...block, url: e.target.value })}
            />
            {!block.url.trim() && !invalid && (
              <p className="text-xs text-muted-foreground">{buttonLinkHint}</p>
            )}
          </div>
        </div>
      )}

      {block.type === 'divider' && (
        <p className="text-sm text-muted-foreground">
          A thin line between parts of your email.
        </p>
      )}

      {issues.map((issue) => (
        <p key={issue} className="text-xs text-destructive">
          {issue}
        </p>
      ))}
    </Card>
  )
}
