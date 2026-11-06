import {
  EMAIL_BLOCK_BUTTON_LABEL_MAX_LENGTH,
  EMAIL_HEADING_MAX_LENGTH,
  EMAIL_LAYOUT_PRESETS,
  EMAIL_PARAGRAPH_MAX_LENGTH,
  EmailContentDraftSchema,
  EmailContentSchema,
  type EmailAiDraftFields,
  type EmailBlockDraft,
  type EmailContentDraft,
  type EmailContentView,
  type EmailLayoutPresetKey,
  type EmailThemeKey,
} from '@goodparty_org/contracts'

export type PhotoPosition = 'top' | 'bottom'

// The compose form. It is saved, previewed and sent as blocks (`toContent`);
// a draft's blocks load back into it with `fromContent`.
export interface EmailComposeState {
  layout: EmailLayoutPresetKey
  theme: EmailThemeKey
  subject: string
  title: string
  message: string
  photoUrl: string
  // Only a personal letter lets the author pick; the other layouts fix it.
  photoPosition: PhotoPosition
  buttonLabel: string
  buttonUrl: string
  // Add a button pressed on the look step, before anything is typed into it.
  buttonAdded?: boolean
  // The writing as the last AI draft left it, so Regenerate knows whether it
  // would throw away the user's own edits. Kept in state so it survives
  // leaving compose and coming back.
  pristine?: string
}

export type ComposeField = 'subject' | 'title' | 'message' | 'photo' | 'button'

export type ComposeIssues = Partial<Record<ComposeField, string>>

export interface ComposeFieldError {
  field: ComposeField
  message: string
}

export const DEFAULT_EMAIL_LAYOUT: EmailLayoutPresetKey = 'personal_letter'

export const initialCompose = (): EmailComposeState => ({
  layout: DEFAULT_EMAIL_LAYOUT,
  theme: EMAIL_LAYOUT_PRESETS[DEFAULT_EMAIL_LAYOUT].defaultTheme,
  subject: '',
  title: '',
  message: '',
  photoUrl: '',
  photoPosition: 'top',
  buttonLabel: '',
  buttonUrl: '',
})

// Spaces around the mark are optional: "##Why", " ## Why" and "## Why" all
// read as a subheading, since a missed space is not something people notice.
const SUBHEADING_MARK = /^\s*##\s*/

// A blank line starts a new paragraph and a line starting with `##` is a
// subheading.
export const messageToBlocks = (message: string): EmailBlockDraft[] => {
  const blocks: EmailBlockDraft[] = []
  const chunks = message.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)
  for (const chunk of chunks) {
    let lines: string[] = []
    const flush = () => {
      const text = lines.join('\n').trim()
      if (text) blocks.push({ type: 'paragraph', text })
      lines = []
    }
    for (const line of chunk.split('\n')) {
      const mark = SUBHEADING_MARK.exec(line)
      if (mark) {
        flush()
        blocks.push({
          type: 'heading',
          text: line.slice(mark[0].length).trim(),
          level: 2,
        })
      } else {
        lines.push(line)
      }
    }
    flush()
  }
  return blocks
}

// The form as blocks, in the order the layout usually has them: photo, title,
// message, button (a personal letter's photo goes first or last).
export const toContent = (state: EmailComposeState): EmailContentDraft => {
  const { layout } = state
  const photo: EmailBlockDraft[] = state.photoUrl
    ? [{ type: 'image', url: state.photoUrl, alt: '' }]
    : []
  const title: EmailBlockDraft[] = state.title.trim()
    ? [{ type: 'heading', text: state.title, level: 1 }]
    : []
  const body = messageToBlocks(state.message)
  const button: EmailBlockDraft[] =
    state.buttonLabel.trim() || state.buttonUrl.trim()
      ? [{ type: 'button', label: state.buttonLabel, url: state.buttonUrl }]
      : []
  const blocks =
    layout === 'short_cta'
      ? [...photo, ...title, ...body, ...button]
      : layout === 'long_update'
        ? [...title, ...photo, ...body, ...button]
        : state.photoPosition === 'bottom'
          ? [...title, ...body, ...button, ...photo]
          : [...photo, ...title, ...body, ...button]
  return { layout, theme: state.theme, subject: state.subject, blocks }
}

// Saved or AI-drafted blocks back into the form. The first headline is the
// title, paragraphs join with blank lines, a subheading becomes a `## ` line
// and dividers are dropped. Keeps only the first photo and button.
export const fromContent = (
  content: EmailContentView | EmailContentDraft,
): Omit<EmailComposeState, 'pristine'> => {
  const { layout } = content
  const parts: string[] = []
  let title: string | null = null
  let photo: { url: string; position: PhotoPosition } | null = null
  let button: { label: string; url: string } | null = null
  for (const [index, block] of content.blocks.entries()) {
    if (block.type === 'heading') {
      if (block.level === 1 && title === null) {
        title = block.text
      } else if (block.text.trim()) {
        parts.push(`## ${block.text.trim()}`)
      }
    } else if (block.type === 'paragraph') {
      if (block.text.trim()) parts.push(block.text.trim())
    } else if (block.type === 'image') {
      photo ??= {
        url: block.url,
        position: layout === 'personal_letter' && index > 0 ? 'bottom' : 'top',
      }
    } else if (block.type === 'button') {
      button ??= { label: block.label, url: block.url }
    }
  }
  return {
    layout,
    theme: content.theme,
    subject: content.subject,
    title: title ?? '',
    message: parts.join('\n\n'),
    photoUrl: photo?.url ?? '',
    photoPosition: photo?.position ?? 'top',
    buttonLabel: button?.label ?? '',
    buttonUrl: button?.url ?? '',
  }
}

// Nothing written yet. An uploaded photo or a typed link doesn't count, since
// the AI draft keeps both.
export const hasNoWriting = (state: EmailComposeState): boolean =>
  !state.subject.trim() &&
  !state.title.trim() &&
  !state.message.trim() &&
  !state.buttonLabel.trim()

export const isUntouched = (state: EmailComposeState): boolean =>
  hasNoWriting(state) && !state.photoUrl && !state.buttonUrl.trim()

export const snapshot = (state: EmailComposeState): string =>
  JSON.stringify([state.subject, state.title, state.message, state.buttonLabel])

// A layout pick keeps every field. The theme follows the layout unless the
// user picked one.
export const switchLayout = (
  state: EmailComposeState,
  layout: EmailLayoutPresetKey,
): EmailComposeState => ({
  ...state,
  layout,
  theme:
    state.theme === EMAIL_LAYOUT_PRESETS[state.layout].defaultTheme
      ? EMAIL_LAYOUT_PRESETS[layout].defaultTheme
      : state.theme,
})

// The AI draft fills the form, keeping the user's layout, a photo they
// uploaded and a link they typed. A field the draft leaves out keeps its
// value.
export const fillFromAiDraft = (
  state: EmailComposeState,
  content: EmailContentView,
): EmailComposeState => {
  const drafted = fromContent(content)
  const next: EmailComposeState = {
    ...state,
    subject: drafted.subject,
    title: drafted.title || state.title,
    message: drafted.message,
    buttonLabel: drafted.buttonLabel || state.buttonLabel,
    buttonUrl: state.buttonUrl.trim() ? state.buttonUrl : drafted.buttonUrl,
  }
  return { ...next, pristine: snapshot(next) }
}

// What "Improve with AI" sends: the form as the draft endpoint's fields.
export const toAiFields = (state: EmailComposeState): EmailAiDraftFields => ({
  subject: state.subject.trim(),
  headline: state.title.trim() || null,
  body: state.message.trim(),
  buttonLabel: state.buttonLabel.trim() || null,
})

// The improved text goes back into its fields. A suggested button label is
// taken only where there is a button to label.
export const applyImprovedDraft = (
  state: EmailComposeState,
  draft: EmailAiDraftFields,
): EmailComposeState => ({
  ...state,
  subject: draft.subject,
  title: draft.headline || state.title,
  message: draft.body,
  buttonLabel:
    draft.buttonLabel && state.buttonLabel.trim()
      ? draft.buttonLabel
      : state.buttonLabel,
})

const EMPTY_MESSAGE = 'This can’t be empty'

const fieldOf = (block: EmailBlockDraft): ComposeField => {
  switch (block.type) {
    case 'heading':
      return block.level === 1 ? 'title' : 'message'
    case 'image':
      return 'photo'
    case 'button':
      return 'button'
    case 'paragraph':
    case 'divider':
      return 'message'
  }
}

const withPeriod = (text: string): string =>
  /[.!?]$/.test(text) ? text : `${text}.`

const tooLong = (block: EmailBlockDraft, key: unknown): string => {
  switch (block.type) {
    case 'heading':
      return block.level === 1
        ? `Keep the title under ${EMAIL_HEADING_MAX_LENGTH} characters.`
        : `Keep each subheading under ${EMAIL_HEADING_MAX_LENGTH} characters.`
    case 'paragraph':
      return `Keep each paragraph under ${EMAIL_PARAGRAPH_MAX_LENGTH.toLocaleString('en-US')} characters.`
    case 'image':
      return 'Upload the photo again.'
    case 'button':
      return key === 'label'
        ? `Keep the button text under ${EMAIL_BLOCK_BUTTON_LABEL_MAX_LENGTH} characters.`
        : 'Use a shorter link.'
    case 'divider':
      return 'Shorten your message.'
  }
}

const missing = (block: EmailBlockDraft, key: unknown): string => {
  switch (block.type) {
    case 'heading':
      return 'Write the subheading after ##, or remove that line.'
    case 'paragraph':
    case 'divider':
      return 'Write your message.'
    case 'image':
      return 'Upload the photo again.'
    case 'button':
      return key === 'url'
        ? 'Add the link this button opens.'
        : 'Add the button text.'
  }
}

const blockMessage = (
  block: EmailBlockDraft,
  key: unknown,
  code: string,
  message: string,
): string => {
  if (code === 'too_big') return tooLong(block, key)
  if (message === EMPTY_MESSAGE) return missing(block, key)
  if (key === 'url') {
    // An empty link fails as "must start with https://", which isn't what's
    // wrong with it. A photo's link is ours, so the fix is a new upload.
    if (block.type === 'image') return 'Upload the photo again.'
    if (block.type === 'button' && !block.url.trim()) return missing(block, key)
  }
  return withPeriod(message)
}

// The whole-email rules, said about the field that fixes them.
const ruleIssue = (code: string, message: string): ComposeFieldError => {
  if (code === 'too_small' || message === 'Add a paragraph') {
    return { field: 'message', message: 'Write your message.' }
  }
  if (code === 'too_big') {
    return {
      field: 'message',
      message: 'Use fewer paragraphs and subheadings.',
    }
  }
  return { field: 'message', message: withPeriod(message) }
}

const findIssues = (
  state: EmailComposeState,
  final: boolean,
): ComposeFieldError[] => {
  const content = toContent(state)
  const result = (
    final ? EmailContentSchema : EmailContentDraftSchema
  ).safeParse(content)
  if (result.success) return []
  return result.error.issues.map((issue): ComposeFieldError => {
    const [root, index, key] = issue.path
    if (root === 'subject') {
      return {
        field: 'subject',
        message:
          issue.message === EMPTY_MESSAGE
            ? 'Add a subject line.'
            : issue.code === 'too_big'
              ? 'Shorten the subject line.'
              : withPeriod(issue.message),
      }
    }
    const block =
      root === 'blocks' && typeof index === 'number'
        ? content.blocks[index]
        : undefined
    if (block && key !== undefined) {
      return {
        field: fieldOf(block),
        message: blockMessage(block, key, issue.code, issue.message),
      }
    }
    return ruleIssue(issue.code, issue.message)
  })
}

const byField = (found: ComposeFieldError[]): ComposeIssues => {
  const issues: ComposeIssues = {}
  for (const { field, message } of found) issues[field] ??= message
  return issues
}

// Plain errors keyed by the field that fixes them. `final` checks what can be
// sent (after Next); otherwise only what's wrong even while typing.
export const composeIssues = (
  state: EmailComposeState,
  final: boolean,
): ComposeIssues => byField(findIssues(state, final))

export const hasIssues = (issues: ComposeIssues): boolean =>
  Object.keys(issues).length > 0

// The fields on the write step. The button is set on the look step.
const WRITE_FIELDS = ['subject', 'title', 'message', 'photo'] as const

// What the write step shows and holds Next on.
export const writeStepIssues = (
  state: EmailComposeState,
  final: boolean,
): ComposeIssues => {
  const issues = composeIssues(state, final)
  const picked: ComposeIssues = {}
  for (const field of WRITE_FIELDS) {
    if (issues[field]) picked[field] = issues[field]
  }
  return picked
}

// A button with text or a link shows even if it was never added on the look
// step, so a saved or AI-drafted button is never hidden.
export const hasButton = (state: EmailComposeState): boolean =>
  Boolean(state.buttonAdded) ||
  state.buttonLabel.trim() !== '' ||
  state.buttonUrl.trim() !== ''

// What holds the look step's Next: an added button needs its text and an
// https link. With no button, nothing on the step is required.
export const lookStepIssue = (state: EmailComposeState): string | undefined => {
  if (!hasButton(state)) return undefined
  const issue = composeIssues(state, true).button
  if (issue) return issue
  if (!state.buttonLabel.trim()) return 'Add the button text.'
  if (!state.buttonUrl.trim()) return 'Add the link this button opens.'
  return undefined
}

const BLOCK_ERROR = /Block (\d+): (.+)$/

// Confirm and the test send name the block they refuse, such as
// "Finish the email before sending it. Block 4: Links must start with https://".
export const isBlockError = (message: string): boolean =>
  BLOCK_ERROR.test(message)

// The refused block, said about the form field it came from. The local check
// words it in the form's terms when it finds the same problem.
export const serverFieldError = (
  state: EmailComposeState,
  message: string,
): ComposeFieldError | null => {
  const match = BLOCK_ERROR.exec(message)
  if (!match) return null
  const block = toContent(state).blocks[Number(match[1]) - 1]
  const field = block ? fieldOf(block) : 'message'
  return {
    field,
    message:
      composeIssues(state, true)[field] ??
      (field === 'photo'
        ? 'Upload the photo again.'
        : withPeriod(match[2]!.trim())),
  }
}
