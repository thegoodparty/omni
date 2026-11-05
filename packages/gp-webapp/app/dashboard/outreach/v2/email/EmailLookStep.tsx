import {
  EMAIL_BLOCK_BUTTON_LABEL_MAX_LENGTH,
  EMAIL_LAYOUT_PRESETS,
  EMAIL_THEMES,
  EMAIL_URL_MAX_LENGTH,
  EmailLayoutPresetKeySchema,
  EmailThemeKeySchema,
  type EmailLayoutPresetKey,
  type EmailThemeKey,
} from '@goodparty_org/contracts'
import {
  Button,
  cn,
  FilterPill,
  FilterPillGroup,
  Input,
  Label,
} from '@styleguide'
import { Intro } from '../social/Intro'
import { EmailPreview } from './EmailPreview'
import {
  composeIssues,
  hasButton,
  switchLayout,
  toContent,
  type ComposeFieldError,
  type EmailComposeState,
  type PhotoPosition,
} from './emailForm.util'
import type { EmailSurface } from './emailSurface'

const PHOTO_POSITIONS: { value: PhotoPosition; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'bottom', label: 'Bottom' },
]

interface EmailLookStepProps {
  surface: EmailSurface
  value: EmailComposeState
  onChange: (next: EmailComposeState) => void
  showIssues: boolean
  // What confirm or the test send refused about the button, shown until the
  // next edit.
  serverError?: ComposeFieldError | null
}

export const EmailLookStep = ({
  surface,
  value,
  onChange,
  showIssues,
  serverError = null,
}: EmailLookStepProps) => {
  const set = <K extends keyof EmailComposeState>(
    key: K,
    next: EmailComposeState[K],
  ) => onChange({ ...value, [key]: next })

  const pickLayout = (layout: EmailLayoutPresetKey) => {
    if (layout === value.layout) return
    onChange(switchLayout(value, layout))
  }

  // Next stays off until an added button is complete, so its error shows as
  // soon as a link is typed. Text with no link yet gets the prompt instead.
  const buttonError =
    serverError?.field === 'button'
      ? serverError.message
      : composeIssues(value, showIssues || value.buttonUrl.trim() !== '').button

  return (
    <div className="space-y-6">
      <Intro title={surface.look.title} body={surface.look.caption} />

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

      {value.layout === 'personal_letter' && value.photoUrl && (
        <div className="space-y-2">
          <span className="block text-sm font-medium text-foreground">
            Photo
          </span>
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
        </div>
      )}

      <div className="space-y-3" data-testid="email-button">
        <span className="block text-sm font-medium text-foreground">
          Button (optional)
        </span>
        {hasButton(value) ? (
          <>
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
              {!value.buttonUrl.trim() && !buttonError && (
                <p className="text-xs text-muted-foreground">
                  {surface.compose.buttonLinkHint}
                </p>
              )}
            </div>
            {value.buttonLabel.trim() &&
              !value.buttonUrl.trim() &&
              !showIssues && (
                <p
                  className="text-sm text-foreground"
                  data-testid="email-link-prompt"
                >
                  Add a link to your button before you continue.
                </p>
              )}
            {buttonError && (
              <p className="text-xs text-destructive">{buttonError}</p>
            )}
            <Button
              type="button"
              size="small"
              variant="outline"
              onClick={() =>
                onChange({
                  ...value,
                  buttonLabel: '',
                  buttonUrl: '',
                  buttonAdded: false,
                })
              }
            >
              Remove button
            </Button>
          </>
        ) : (
          <Button
            type="button"
            size="small"
            variant="outline"
            onClick={() => set('buttonAdded', true)}
          >
            Add a button
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <span className="text-sm font-medium text-foreground">Preview</span>
        <EmailPreview serve={surface.isServe} content={toContent(value)} />
      </div>
    </div>
  )
}
