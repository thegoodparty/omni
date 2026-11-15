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
  FilterPill,
  FilterPillGroup,
  Input,
  Label,
  Card,
} from '@styleguide'
import { Intro } from '../social/Intro'
import { EmailPreview } from './EmailPreview'
import {
  composeIssues,
  hasButton,
  lookStepIssue,
  switchLayout,
  toContent,
  type ComposeFieldError,
  type EmailComposeState,
} from './emailForm.util'
import type { EmailSurface } from './emailSurface'

// A theme with a white header is known by its page color instead, so Cream
// and forest shows cream rather than a blank circle.
const swatchOf = (key: EmailThemeKey): string => {
  const { header, bg } = EMAIL_THEMES[key].colors
  return header.toUpperCase() === '#FFFFFF' ? bg : header
}

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

  // Continue stays on, so once it is pressed the error is whatever holds it.
  // Before that a typed link is checked as it is typed, and text with no
  // link yet gets the prompt instead.
  const buttonError =
    serverError?.field === 'button'
      ? serverError.message
      : showIssues
        ? lookStepIssue(value)
        : composeIssues(value, value.buttonUrl.trim() !== '').button

  return (
    <div className="space-y-6">
      <Intro title={surface.look.title} body={surface.look.caption} />

      <Card className="gap-6 px-6 py-5">
        <div className="space-y-2">
          <h4 className="text-base font-semibold text-foreground">Layout</h4>
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
      </Card>

      <Card className="gap-6 px-6 py-5">
        <div className="space-y-3">
          <h4 className="text-base font-semibold text-foreground">Colors</h4>
          <FilterPillGroup
            type="single"
            value={value.theme}
            aria-label="Colors"
            onValueChange={(next) => {
              const parsed = EmailThemeKeySchema.safeParse(next)
              if (parsed.success) set('theme', parsed.data)
            }}
          >
            {EmailThemeKeySchema.options.map((key: EmailThemeKey) => (
              <FilterPill key={key} value={key}>
                <span className="flex items-center gap-2">
                  {/* The swatch is the theme's own color, not a design
                      token. */}
                  <span
                    aria-hidden
                    className="size-4 rounded-full border border-border"
                    style={{ backgroundColor: swatchOf(key) }}
                  />
                  {EMAIL_THEMES[key].label}
                </span>
              </FilterPill>
            ))}
          </FilterPillGroup>
        </div>
      </Card>

      <Card className="gap-6 px-6 py-5">
        <div className="space-y-3" data-testid="email-button">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-baseline gap-2">
              <h4 className="text-base font-semibold text-foreground">
                Button
              </h4>
              <span className="text-sm text-muted-foreground">Optional</span>
            </div>
            {hasButton(value) && (
              <Button
                type="button"
                size="small"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() =>
                  onChange({
                    ...value,
                    buttonLabel: '',
                    buttonUrl: '',
                    buttonAdded: false,
                  })
                }
              >
                Remove
              </Button>
            )}
          </div>
          {hasButton(value) ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="email-button-label">Text</Label>
                <Input
                  id="email-button-label"
                  value={value.buttonLabel}
                  maxLength={EMAIL_BLOCK_BUTTON_LABEL_MAX_LENGTH}
                  onChange={(e) => set('buttonLabel', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email-button-url">Link</Label>
                <Input
                  id="email-button-url"
                  type="url"
                  placeholder="https://"
                  value={value.buttonUrl}
                  maxLength={EMAIL_URL_MAX_LENGTH}
                  onChange={(e) => set('buttonUrl', e.target.value)}
                />
                {!value.buttonUrl.trim() && !buttonError && (
                  <p className="text-sm text-muted-foreground">
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
      </Card>

      <div className="space-y-3">
        <h4 className="text-base font-semibold text-foreground">Preview</h4>
        <EmailPreview serve={surface.isServe} content={toContent(value)} />
      </div>
    </div>
  )
}
