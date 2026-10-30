import {
  EMAIL_LAYOUT_PRESETS,
  EMAIL_MAX_BLOCKS,
  EmailContentDraftSchema,
  EmailContentSchema,
  checkEmailLayout,
  type EmailAiDraftFields,
  type EmailBlockDraft,
  type EmailBlockType,
  type EmailContentDraft,
  type EmailContentView,
  type EmailLayoutPresetKey,
  type EmailThemeKey,
} from '@goodparty_org/contracts'

// A block plus a key that follows it through moves, so a card keeps its
// focus and its editor when it changes place.
export interface EditorBlock {
  id: string
  block: EmailBlockDraft
}

export interface EmailComposeState {
  layout: EmailLayoutPresetKey
  theme: EmailThemeKey
  subject: string
  blocks: EditorBlock[]
}

let lastId = 0
const blockId = (): string => {
  lastId += 1
  return `block-${lastId}`
}

export const withIds = (blocks: readonly EmailBlockDraft[]): EditorBlock[] =>
  blocks.map((block) => ({ id: blockId(), block: { ...block } }))

const plain = (blocks: readonly EditorBlock[]): EmailBlockDraft[] =>
  blocks.map(({ block }) => block)

export const DEFAULT_EMAIL_LAYOUT: EmailLayoutPresetKey = 'personal_letter'

export const starterCompose = (
  layout: EmailLayoutPresetKey,
  subject = '',
): EmailComposeState => ({
  layout,
  theme: EMAIL_LAYOUT_PRESETS[layout].defaultTheme,
  subject,
  blocks: withIds(EMAIL_LAYOUT_PRESETS[layout].starterBlocks),
})

export const initialCompose = (): EmailComposeState =>
  starterCompose(DEFAULT_EMAIL_LAYOUT)

export const toContent = (state: EmailComposeState): EmailContentDraft => ({
  layout: state.layout,
  theme: state.theme,
  subject: state.subject,
  blocks: plain(state.blocks),
})

const blockHasContent = (block: EmailBlockDraft): boolean => {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      return block.text.trim() !== ''
    case 'image':
      return block.url !== '' || block.alt.trim() !== ''
    case 'button':
      return block.label.trim() !== '' || block.url.trim() !== ''
    case 'divider':
      return false
  }
}

// Nothing typed or uploaded yet, so a layout pick or the AI draft can take
// over without losing anything.
export const isUntouched = (state: EmailComposeState): boolean =>
  state.subject.trim() === '' &&
  state.blocks.every(({ block }) => !blockHasContent(block))

// Layout rule messages, so a change can be judged by whether it breaks a rule
// that holds now. Indexes shift on every edit, so only messages are compared.
const ruleMessages = (
  layout: EmailLayoutPresetKey,
  blocks: readonly EmailBlockDraft[],
): string[] => checkEmailLayout(layout, blocks).map((issue) => issue.message)

const breaksNoRule = (
  layout: EmailLayoutPresetKey,
  before: readonly EmailBlockDraft[],
  after: readonly EmailBlockDraft[],
): boolean => {
  const held = ruleMessages(layout, before)
  return ruleMessages(layout, after).every((message) => held.includes(message))
}

export const canMove = (
  layout: EmailLayoutPresetKey,
  blocks: readonly EditorBlock[],
  index: number,
  direction: -1 | 1,
): boolean => {
  const target = index + direction
  if (target < 0 || target >= blocks.length) return false
  const before = plain(blocks)
  const after = [...before]
  ;[after[index], after[target]] = [after[target]!, after[index]!]
  return breaksNoRule(layout, before, after)
}

export const moveBlock = (
  blocks: readonly EditorBlock[],
  index: number,
  direction: -1 | 1,
): EditorBlock[] => {
  const next = [...blocks]
  const target = index + direction
  ;[next[index], next[target]] = [next[target]!, next[index]!]
  return next
}

export const canRemove = (
  layout: EmailLayoutPresetKey,
  blocks: readonly EditorBlock[],
  index: number,
): boolean => {
  const before = plain(blocks)
  return breaksNoRule(
    layout,
    before,
    before.filter((_, i) => i !== index),
  )
}

export type AddableKind =
  | 'headline'
  | 'subheading'
  | 'paragraph'
  | 'image'
  | 'button'
  | 'divider'

const NEW_BLOCK: Record<AddableKind, EmailBlockDraft> = {
  headline: { type: 'heading', text: '', level: 1 },
  subheading: { type: 'heading', text: '', level: 2 },
  paragraph: { type: 'paragraph', text: '' },
  image: { type: 'image', url: '', alt: '' },
  button: { type: 'button', label: '', url: '' },
  divider: { type: 'divider' },
}

const KIND_TYPE: Record<AddableKind, EmailBlockType> = {
  headline: 'heading',
  subheading: 'heading',
  paragraph: 'paragraph',
  image: 'image',
  button: 'button',
  divider: 'divider',
}

const ADD_ORDER: readonly AddableKind[] = [
  'paragraph',
  'headline',
  'subheading',
  'image',
  'button',
  'divider',
]

// Where a new block of this kind would go: at the end, or just before a
// closing button, or else the lowest place that breaks no layout rule.
const insertAt = (
  layout: EmailLayoutPresetKey,
  blocks: readonly EmailBlockDraft[],
  block: EmailBlockDraft,
): number | null => {
  const end = blocks.length
  const tries = [
    ...(blocks[end - 1]?.type === 'button' && block.type !== 'button'
      ? [end - 1]
      : []),
    ...Array.from({ length: end + 1 }, (_, i) => end - i),
  ]
  return (
    tries.find((at) =>
      breaksNoRule(layout, blocks, [
        ...blocks.slice(0, at),
        block,
        ...blocks.slice(at),
      ]),
    ) ?? null
  )
}

// The kinds the layout allows that have a place to go right now.
export const addableKinds = (
  layout: EmailLayoutPresetKey,
  blocks: readonly EditorBlock[],
): AddableKind[] => {
  if (blocks.length >= EMAIL_MAX_BLOCKS) return []
  const allowed: readonly EmailBlockType[] =
    EMAIL_LAYOUT_PRESETS[layout].allowedBlocks
  const before = plain(blocks)
  return ADD_ORDER.filter(
    (kind) =>
      allowed.includes(KIND_TYPE[kind]) &&
      insertAt(layout, before, NEW_BLOCK[kind]) !== null,
  )
}

export const addBlock = (
  layout: EmailLayoutPresetKey,
  blocks: readonly EditorBlock[],
  kind: AddableKind,
): EditorBlock[] => {
  const at = insertAt(layout, plain(blocks), NEW_BLOCK[kind])
  if (at === null) return [...blocks]
  return [
    ...blocks.slice(0, at),
    { id: blockId(), block: { ...NEW_BLOCK[kind] } },
    ...blocks.slice(at),
  ]
}

export interface Conversion {
  blocks: EditorBlock[]
  // Plain-language notes on what the new layout couldn't keep as it was.
  changes: string[]
}

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`

const listOf = (items: string[]): string =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

const paragraphOf = (text: string): EditorBlock => ({
  id: blockId(),
  block: { type: 'paragraph', text },
})

const fresh = (block: EmailBlockDraft): EditorBlock => ({
  id: blockId(),
  block,
})

// Rearranges blocks for another layout, keeping every word: a heading the
// layout has no room for becomes a paragraph. Only extra photos, extra
// buttons and dividers can be dropped, and the changes say so.
export const convertBlocks = (
  from: readonly EditorBlock[],
  to: EmailLayoutPresetKey,
): Conversion => {
  const images = from.filter(({ block }) => block.type === 'image')
  const keptImage =
    images.find(({ block }) => block.type === 'image' && block.url !== '') ??
    images[0]
  const buttons = from.filter(({ block }) => block.type === 'button')
  const keptButton =
    buttons.find(({ block }) => blockHasContent(block)) ?? buttons[0]
  const droppedPhotos = images.filter(
    (entry) => entry !== keptImage && blockHasContent(entry.block),
  ).length
  const droppedButtons = buttons.filter(
    (entry) => entry !== keptButton && blockHasContent(entry.block),
  ).length
  const dividers = from.filter(({ block }) => block.type === 'divider').length
  const removed: string[] = []
  if (droppedPhotos > 0) removed.push(plural(droppedPhotos, 'photo', 'photos'))
  if (droppedButtons > 0) {
    removed.push(plural(droppedButtons, 'button', 'buttons'))
  }
  if (dividers > 0 && to !== 'long_update') {
    removed.push(plural(dividers, 'divider', 'dividers'))
  }
  const changes: string[] = []
  if (removed.length > 0) {
    changes.push(
      `This layout has no room for ${listOf(removed)}, so we removed them.`,
    )
  }

  const isText = ({ block }: EditorBlock) =>
    block.type === 'heading' || block.type === 'paragraph'
  const textOf = ({ block }: EditorBlock): string =>
    block.type === 'heading' || block.type === 'paragraph' ? block.text : ''
  const headings = from.filter(({ block }) => block.type === 'heading')
  const lead =
    headings.find(
      ({ block }) => block.type === 'heading' && block.level === 1,
    ) ?? headings[0]
  const image =
    keptImage?.block.type === 'image' && keptImage.block.url !== ''
      ? keptImage
      : undefined

  if (to === 'short_cta') {
    const texts = from
      .filter((entry) => isText(entry) && entry !== lead)
      .map(textOf)
      .map((text) => text.trim())
      .filter(Boolean)
    if (headings.length > 1) {
      changes.push('Your extra headings are now paragraphs.')
    }
    if (texts.length > 2) {
      changes.push('Your text is now in two paragraphs.')
    }
    const paragraphs =
      texts.length === 0
        ? [paragraphOf('')]
        : texts.length <= 2
          ? texts.map(paragraphOf)
          : [paragraphOf(texts[0]!), paragraphOf(texts.slice(1).join('\n\n'))]
    return {
      blocks: [
        ...(image ? [image] : []),
        lead
          ? {
              id: lead.id,
              block: { type: 'heading', text: textOf(lead), level: 1 },
            }
          : fresh({ type: 'heading', text: '', level: 1 }),
        ...paragraphs,
        keptButton ?? fresh({ type: 'button', label: '', url: '' }),
      ],
      changes,
    }
  }

  if (to === 'long_update') {
    const rest = from
      .filter(
        (entry) =>
          entry !== lead &&
          entry.block.type !== 'image' &&
          (entry.block.type !== 'button' || entry === keptButton) &&
          !(entry.block.type === 'paragraph' && !entry.block.text.trim()),
      )
      .map(
        (entry): EditorBlock =>
          entry.block.type === 'heading'
            ? { id: entry.id, block: { ...entry.block, level: 2 } }
            : entry,
      )
    const paragraphCount = rest.filter(
      ({ block }) => block.type === 'paragraph',
    ).length
    const padding = Array.from(
      { length: Math.max(0, 2 - paragraphCount) },
      () => paragraphOf(''),
    )
    const body =
      rest[rest.length - 1]?.block.type === 'button'
        ? [...rest.slice(0, -1), ...padding, rest[rest.length - 1]!]
        : [...rest, ...padding]
    return {
      blocks: [
        lead
          ? {
              id: lead.id,
              block: { type: 'heading', text: textOf(lead), level: 1 },
            }
          : fresh({ type: 'heading', text: '', level: 1 }),
        ...(image ? [image] : []),
        ...body,
      ],
      changes,
    }
  }

  // personal_letter: headings read as paragraphs, and the photo goes at the
  // top if it came before the first paragraph, else at the end.
  if (headings.length > 0) changes.push('Your headings are now paragraphs.')
  const firstParagraphAt = from.findIndex(
    ({ block }) => block.type === 'paragraph',
  )
  const imageFirst =
    image !== undefined &&
    (firstParagraphAt === -1 || from.indexOf(image) < firstParagraphAt)
  const sequence = from
    .filter(
      (entry) =>
        (isText(entry) && textOf(entry).trim() !== '') || entry === keptButton,
    )
    .map(
      (entry): EditorBlock =>
        entry.block.type === 'heading'
          ? {
              id: entry.id,
              block: { type: 'paragraph', text: entry.block.text },
            }
          : entry,
    )
  const opening =
    sequence[0]?.block.type === 'button'
      ? [...sequence.slice(1), sequence[0]]
      : sequence
  const letter = opening.some(({ block }) => block.type === 'paragraph')
    ? opening
    : [paragraphOf(''), ...opening]
  return {
    blocks: [
      ...(image && imageFirst ? [image] : []),
      ...letter,
      ...(image && !imageFirst ? [image] : []),
    ],
    changes,
  }
}

// A layout pick. Untouched content takes the new layout's starter blocks;
// anything written is rearranged to fit it. The theme follows the layout
// unless the user picked one.
export const switchLayout = (
  state: EmailComposeState,
  layout: EmailLayoutPresetKey,
): { state: EmailComposeState; changes: string[] } => {
  const theme =
    state.theme === EMAIL_LAYOUT_PRESETS[state.layout].defaultTheme
      ? EMAIL_LAYOUT_PRESETS[layout].defaultTheme
      : state.theme
  if (isUntouched(state)) {
    return { state: { ...starterCompose(layout), theme }, changes: [] }
  }
  const { blocks, changes } = convertBlocks(state.blocks, layout)
  return { state: { ...state, layout, theme, blocks }, changes }
}

// The AI draft's blocks, fitted to the layout the user has now, keeping a
// photo they uploaded and a link they typed.
export const fillFromAiDraft = (
  state: EmailComposeState,
  content: EmailContentView,
): EmailComposeState => {
  const drafted = withIds(content.blocks)
  let blocks =
    content.layout === state.layout
      ? drafted
      : convertBlocks(drafted, state.layout).blocks
  const myImage = state.blocks.find(
    ({ block }) => block.type === 'image' && block.url !== '',
  )
  if (myImage && !blocks.some(({ block }) => block.type === 'image')) {
    const at =
      state.layout === 'long_update' && blocks[0]?.block.type === 'heading'
        ? 1
        : 0
    blocks = [...blocks.slice(0, at), myImage, ...blocks.slice(at)]
  }
  const myButton = state.blocks.find(
    ({ block }) => block.type === 'button' && block.url.trim() !== '',
  )
  if (myButton?.block.type === 'button') {
    const url = myButton.block.url
    blocks = blocks.map((entry) =>
      entry.block.type === 'button' && entry.block.url === ''
        ? { ...entry, block: { ...entry.block, url } }
        : entry,
    )
  }
  return { ...state, subject: content.subject, blocks }
}

// What "Improve with AI" sends: the email as the draft endpoint's fields.
export const toAiFields = (state: EmailComposeState): EmailAiDraftFields => {
  const blocks = plain(state.blocks)
  const headline = blocks.find(
    (block) => block.type === 'heading' && block.level === 1,
  )
  const button = blocks.find((block) => block.type === 'button')
  return {
    subject: state.subject.trim(),
    headline:
      headline?.type === 'heading' && headline.text.trim()
        ? headline.text.trim()
        : null,
    body: blocks
      .flatMap((block) =>
        block.type === 'paragraph' && block.text.trim()
          ? [block.text.trim()]
          : [],
      )
      .join('\n\n'),
    buttonLabel:
      button?.type === 'button' && button.label.trim()
        ? button.label.trim()
        : null,
  }
}

// Puts an improved draft back in place. Subheadings, photos, dividers and the
// link stay where they are. Paragraphs take the reply's paragraphs in order:
// extra ones join the last paragraph, and paragraphs the reply merged away
// are removed.
export const applyImprovedDraft = (
  state: EmailComposeState,
  draft: EmailAiDraftFields,
): EmailComposeState => {
  const chunks = draft.body
    .split(/\n{2,}/)
    .map((text) => text.trim())
    .filter(Boolean)
  const written = state.blocks.filter(
    ({ block }) => block.type === 'paragraph' && block.text.trim() !== '',
  )
  const textFor = new Map<string, string | null>(
    written.map((entry, i) => [
      entry.id,
      i < written.length - 1
        ? (chunks[i] ?? null)
        : chunks.slice(i).join('\n\n') || null,
    ]),
  )
  let headlineDone = false
  const blocks = state.blocks.flatMap((entry): EditorBlock[] => {
    const { block } = entry
    if (block.type === 'paragraph' && textFor.has(entry.id)) {
      const text = textFor.get(entry.id)
      return text === null || text === undefined
        ? []
        : [{ ...entry, block: { ...block, text } }]
    }
    if (block.type === 'heading' && block.level === 1 && !headlineDone) {
      headlineDone = true
      return draft.headline
        ? [{ ...entry, block: { ...block, text: draft.headline } }]
        : [entry]
    }
    if (block.type === 'button' && draft.buttonLabel) {
      return [{ ...entry, block: { ...block, label: draft.buttonLabel } }]
    }
    return [entry]
  })
  return { ...state, subject: draft.subject, blocks }
}

export interface EditorIssues {
  subject?: string
  // Keyed by block index.
  blocks: Record<number, string[]>
  // Rules about the email as a whole, such as a missing button.
  email: string[]
}

const EMPTY_MESSAGE = 'This can’t be empty'

const emptyMessage = (block: EmailBlockDraft, field: unknown): string => {
  switch (block.type) {
    case 'heading':
      return 'Write a heading, or remove this block.'
    case 'paragraph':
      return 'Write something here, or remove this block.'
    case 'image':
      return field === 'alt'
        ? 'Describe the photo for people who can’t see it.'
        : 'Upload a photo, or remove this block.'
    case 'button':
      return field === 'url'
        ? 'Add the link this button opens.'
        : 'Add the button’s text.'
    case 'divider':
      return EMPTY_MESSAGE
  }
}

const photoRule: Record<EmailLayoutPresetKey, string> = {
  short_cta: 'This layout allows one photo, at the top.',
  long_update: 'This layout allows one photo, right after the headline.',
  personal_letter: 'This layout allows one photo, at the start or the end.',
}

const NOUNS: Record<EmailBlockType, string> = {
  heading: 'headings',
  paragraph: 'paragraphs',
  image: 'photos',
  button: 'buttons',
  divider: 'dividers',
}

// The contracts' rule messages, in the editor's words.
const friendlyRule = (
  layout: EmailLayoutPresetKey,
  message: string,
): string => {
  const notUsed = /doesn’t use (\w+) blocks$/.exec(message)
  if (notUsed) {
    const noun = NOUNS[notUsed[1] as EmailBlockType] ?? `${notUsed[1]} blocks`
    return `This layout doesn’t use ${noun}.`
  }
  switch (message) {
    case 'Add a button':
      return 'Add a button at the end.'
    case 'Use at most one photo':
    case 'The photo goes first':
    case 'The photo goes right after the headline':
    case 'Put the photo at the very top or the very end':
      return photoRule[layout]
    case 'Start with a level 1 heading':
      return 'Start with a headline.'
    case 'Only the first heading is level 1':
      return 'Only the first heading can be the headline.'
    case 'The headline is level 1':
      return 'This heading needs to be the headline.'
    case 'Use exactly one headline':
      return 'This layout has one headline.'
    case 'Use exactly one button':
    case 'Use at most one button':
      return 'This layout allows one button.'
    case 'The button goes last':
      return 'The button goes at the end.'
    default:
      return /[.!?]$/.test(message) ? message : `${message}.`
  }
}

// `final` checks what can be sent (Next); otherwise only what's wrong even
// while typing, such as a link without https or a rule the order breaks.
export const editorIssues = (
  state: EmailComposeState,
  final: boolean,
): EditorIssues => {
  const issues: EditorIssues = { blocks: {}, email: [] }
  const content = toContent(state)
  const result = (
    final ? EmailContentSchema : EmailContentDraftSchema
  ).safeParse(content)
  if (result.success) return issues
  for (const issue of result.error.issues) {
    const [root, index, field] = issue.path
    if (root === 'subject') {
      issues.subject ??=
        issue.message === EMPTY_MESSAGE
          ? 'Add a subject line.'
          : `${issue.message}.`
      continue
    }
    if (root === 'blocks' && typeof index === 'number') {
      const block = content.blocks[index]
      if (!block) continue
      // An empty link fails as "must start with https://", which isn't
      // what's wrong with it.
      const emptyLink =
        field === 'url' &&
        (block.type === 'image' || block.type === 'button') &&
        block.url.trim() === ''
      // An image with no upload yet only needs the upload, not its alt text.
      if (block.type === 'image' && block.url === '' && field === 'alt') {
        continue
      }
      const message =
        field === undefined
          ? friendlyRule(state.layout, issue.message)
          : issue.message === EMPTY_MESSAGE || emptyLink
            ? emptyMessage(block, field)
            : `${issue.message}.`
      const list = (issues.blocks[index] ??= [])
      if (!list.includes(message)) list.push(message)
      continue
    }
    if (root === 'blocks' && issue.code === 'too_small') {
      issues.email.push('Add a block to write your email.')
      continue
    }
    const message = friendlyRule(state.layout, issue.message)
    if (!issues.email.includes(message)) issues.email.push(message)
  }
  return issues
}

export const hasIssues = (issues: EditorIssues): boolean =>
  issues.subject !== undefined ||
  issues.email.length > 0 ||
  Object.keys(issues.blocks).length > 0

// Confirm and the test send name the block they refuse, such as
// "Finish the email before sending it. Block 4: Links must start with https://".
export interface BlockError {
  index: number
  message: string
}

export const parseBlockError = (message: string): BlockError | null => {
  const match = /Block (\d+): (.+)$/.exec(message)
  if (!match) return null
  const text = match[2]!.trim()
  return {
    index: Number(match[1]) - 1,
    message: /[.!?]$/.test(text) ? text : `${text}.`,
  }
}
