import { z } from 'zod'
import type { EmailBlockDraft, EmailBlockType } from './EmailBlock.schema'
import type { EmailThemeKey } from './EmailTemplate.const'

export const EMAIL_SHORT_CTA_PARAGRAPH_MAX_LENGTH = 600

export interface EmailLayoutPreset {
  label: string
  description: string
  defaultTheme: EmailThemeKey
  allowedBlocks: readonly EmailBlockType[]
  // Read by an agent drafting for this layout, so it is written as guidance.
  rules: readonly string[]
  // What the editor opens with. Text and links are empty for the author to
  // fill, so these pass the draft schema, not the send schema.
  starterBlocks: readonly EmailBlockDraft[]
}

// Keys are new on purpose: EMAIL_LAYOUTS (newsletter, reminder,
// call_to_action) still backs today's fixed-field drafts until step 2 swaps
// the compose flow over.
export const EMAIL_LAYOUT_PRESETS = {
  short_cta: {
    label: 'Short with a button',
    description: 'A photo, a headline, a few lines and one big button.',
    defaultTheme: 'bold_red',
    allowedBlocks: ['image', 'heading', 'paragraph', 'button'],
    rules: [
      'Optional photo, and if there is one it comes first.',
      'Exactly one level 1 heading, right after the photo (or first).',
      `1 or 2 paragraphs, ${EMAIL_SHORT_CTA_PARAGRAPH_MAX_LENGTH} characters at most between them.`,
      'Exactly one button, and it is the last block.',
    ],
    starterBlocks: [
      { type: 'image', url: '', alt: '' },
      { type: 'heading', text: '', level: 1 },
      { type: 'paragraph', text: '' },
      { type: 'button', label: '', url: '' },
    ],
  },
  long_update: {
    label: 'Long update',
    description:
      'A longer read: a headline, then several paragraphs broken up with subheadings.',
    defaultTheme: 'classic_blue',
    allowedBlocks: [
      'heading',
      'paragraph',
      'image',
      'button',
      'divider',
      'signature',
    ],
    rules: [
      'Starts with a level 1 heading (the masthead).',
      'Mostly paragraphs, at least 2. Break up the text with level 2 subheadings and dividers.',
      'Any heading after the masthead is level 2.',
      'At most one photo, and only right after the masthead.',
      'At most one button and one signature.',
      'A signature, if any, is the last block.',
    ],
    starterBlocks: [
      { type: 'heading', text: '', level: 1 },
      { type: 'paragraph', text: '' },
      { type: 'heading', text: '', level: 2 },
      { type: 'paragraph', text: '' },
    ],
  },
  personal_letter: {
    label: 'Personal letter',
    description: 'A plain note from you, signed with your name.',
    defaultTheme: 'cream_and_forest',
    allowedBlocks: ['paragraph', 'button', 'signature'],
    rules: [
      'Starts with a paragraph. No headings and no photos except the signature headshot.',
      'At most one button, drawn as a quiet link.',
      'Exactly one signature, and it is the last block.',
    ],
    starterBlocks: [
      { type: 'paragraph', text: '' },
      { type: 'paragraph', text: '' },
      { type: 'signature', name: '', title: '' },
    ],
  },
} as const satisfies Record<string, EmailLayoutPreset>

export type EmailLayoutPresetKey = keyof typeof EMAIL_LAYOUT_PRESETS

export const EmailLayoutPresetKeySchema = z
  .enum(['short_cta', 'long_update', 'personal_letter'])
  .describe(
    (Object.keys(EMAIL_LAYOUT_PRESETS) as EmailLayoutPresetKey[])
      .map(
        (key) =>
          `${key}: ${EMAIL_LAYOUT_PRESETS[key].description} Allowed blocks: ${EMAIL_LAYOUT_PRESETS[key].allowedBlocks.join(', ')}. ${EMAIL_LAYOUT_PRESETS[key].rules.join(' ')}`,
      )
      .join('\n'),
  ) satisfies z.ZodType<EmailLayoutPresetKey>

export interface EmailLayoutIssue {
  // Index into `blocks`, or null for a rule about the email as a whole.
  blockIndex: number | null
  message: string
  // A required block is still missing. The editor may save that; a send may
  // not. Everything else (a block the layout doesn't use, too many, the wrong
  // order) is wrong in both.
  incomplete: boolean
}

const countOf = (
  blocks: readonly EmailBlockDraft[],
  type: EmailBlockType,
): number => blocks.filter((block) => block.type === type).length

// Structure only (which blocks, how many, in what order). Field rules live on
// the block schemas.
export const checkEmailLayout = (
  layout: EmailLayoutPresetKey,
  blocks: readonly EmailBlockDraft[],
): EmailLayoutIssue[] => {
  const issues: EmailLayoutIssue[] = []
  const add = (blockIndex: number | null, message: string) =>
    issues.push({ blockIndex, message, incomplete: false })
  const missing = (message: string) =>
    issues.push({ blockIndex: null, message, incomplete: true })
  const preset: EmailLayoutPreset = EMAIL_LAYOUT_PRESETS[layout]
  const last = blocks.length - 1

  blocks.forEach((block, index) => {
    if (!preset.allowedBlocks.includes(block.type)) {
      add(index, `The ${preset.label} layout doesn’t use ${block.type} blocks`)
    }
  })

  const atMostOne = (type: EmailBlockType, noun: string) => {
    if (countOf(blocks, type) > 1) add(null, `Use at most one ${noun}`)
  }

  if (layout === 'short_cta') {
    const imageIndexes = blocks.flatMap((block, index) =>
      block.type === 'image' ? [index] : [],
    )
    if (imageIndexes.length > 1) {
      add(null, 'Use at most one photo')
    } else if (imageIndexes.length === 1 && imageIndexes[0] !== 0) {
      add(imageIndexes[0], 'The photo goes first')
    }
    const headingAt = imageIndexes[0] === 0 ? 1 : 0
    const headings = countOf(blocks, 'heading')
    const heading = blocks[headingAt]
    if (headings === 0) {
      missing('Add a headline')
    } else if (headings > 1) {
      add(null, 'Use exactly one headline')
    } else if (heading?.type !== 'heading') {
      add(null, 'The headline goes at the top, after the photo if there is one')
    } else if (heading.level !== 1) {
      add(headingAt, 'The headline is level 1')
    }
    const paragraphs = blocks.filter((block) => block.type === 'paragraph')
    if (paragraphs.length === 0) missing('Add a paragraph')
    if (paragraphs.length > 2) add(null, 'Use 1 or 2 paragraphs')
    const paragraphLength = paragraphs.reduce(
      (sum, block) =>
        sum + (block.type === 'paragraph' ? block.text.length : 0),
      0,
    )
    if (paragraphLength > EMAIL_SHORT_CTA_PARAGRAPH_MAX_LENGTH) {
      add(
        null,
        `Keep the text to ${EMAIL_SHORT_CTA_PARAGRAPH_MAX_LENGTH} characters, or use a long update`,
      )
    }
    const buttons = countOf(blocks, 'button')
    if (buttons === 0) {
      missing('Add a button')
    } else if (buttons > 1) {
      add(null, 'Use exactly one button')
    } else if (blocks[last]?.type !== 'button') {
      add(last, 'The button goes last')
    }
  }

  if (layout === 'long_update') {
    const first = blocks[0]
    if (!blocks.some((b) => b.type === 'heading' && b.level === 1)) {
      missing('Start with a level 1 heading')
    } else if (first?.type !== 'heading' || first.level !== 1) {
      add(0, 'Start with a level 1 heading')
    }
    const imageIndexes = blocks.flatMap((block, index) =>
      block.type === 'image' ? [index] : [],
    )
    if (imageIndexes.length > 1) {
      add(null, 'Use at most one photo')
    } else if (imageIndexes.length === 1 && imageIndexes[0] !== 1) {
      add(imageIndexes[0], 'The photo goes right after the headline')
    }
    if (countOf(blocks, 'paragraph') < 2) missing('Add at least 2 paragraphs')
    blocks.forEach((block, index) => {
      if (index > 0 && block.type === 'heading' && block.level !== 2) {
        add(index, 'Only the first heading is level 1')
      }
    })
    atMostOne('button', 'button')
    atMostOne('signature', 'signature')
    const signatureAt = blocks.findIndex((block) => block.type === 'signature')
    if (signatureAt !== -1 && signatureAt !== last) {
      add(signatureAt, 'The signature goes last')
    }
  }

  if (layout === 'personal_letter') {
    if (countOf(blocks, 'paragraph') === 0) {
      missing('Add a paragraph')
    } else if (blocks[0]?.type !== 'paragraph') {
      add(0, 'Start with a paragraph')
    }
    atMostOne('button', 'button')
    const signatures = countOf(blocks, 'signature')
    if (signatures === 0) {
      missing('Sign it with your name')
    } else if (signatures > 1) {
      add(null, 'Use exactly one signature')
    } else if (blocks[last]?.type !== 'signature') {
      add(last, 'The signature goes last')
    }
  }

  return issues
}
