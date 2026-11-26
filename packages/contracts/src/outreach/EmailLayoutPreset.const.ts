import { z } from 'zod'
import type { EmailBlockDraft, EmailBlockType } from './EmailBlock.schema'
import type { EmailThemeKey } from './EmailTemplate.const'

export interface EmailLayoutPreset {
  label: string
  description: string
  defaultTheme: EmailThemeKey
  // What the layout usually holds, read by an agent drafting for it. Never
  // checked: content valid in one layout is valid in every layout.
  usualBlocks: readonly EmailBlockType[]
  // Set on a preset whose blocks follow one fixed order. Unlike guidance, it
  // is checked: each block must fill a later slot than the one before it.
  structure?: readonly EmailBlockType[]
  guidance: readonly string[]
  // What the editor opens with. Text and links are empty for the author to
  // fill, so these pass the draft schema, not the send schema.
  starterBlocks: readonly EmailBlockDraft[]
}

// Keys are new on purpose: EMAIL_LAYOUTS (newsletter, reminder,
// call_to_action) still backs today's fixed-field drafts until step 2 swaps
// the compose flow over.
export const EMAIL_LAYOUT_PRESETS = {
  short_cta: {
    label: 'Short',
    description: 'A photo, a headline and a few lines.',
    defaultTheme: 'neutral',
    usualBlocks: ['image', 'heading', 'paragraph', 'button'],
    guidance: [
      'Optional photo, and if there is one it comes first.',
      'Exactly one level 1 heading, right after the photo (or first).',
      '1 or 2 paragraphs, 600 characters at most between them.',
      'At most one button, and only when the goal has a clear online action such as signing up, donating, RSVPing or volunteering through a link. If there is one, it is the last block.',
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
    defaultTheme: 'neutral',
    usualBlocks: ['heading', 'paragraph', 'image', 'button', 'divider'],
    guidance: [
      'Starts with a level 1 heading (the masthead).',
      'Mostly paragraphs, at least 2. Break up the text with level 2 subheadings and dividers.',
      'Any heading after the masthead is level 2.',
      'At most one photo, and only right after the masthead.',
      'At most one button, and only when the goal has a clear online action such as signing up, donating, RSVPing or volunteering through a link.',
      'End with a closing paragraph, such as "Thank you," then your name.',
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
    description:
      'A plain note from you, in paragraphs, with an optional photo.',
    defaultTheme: 'neutral',
    usualBlocks: ['paragraph', 'image', 'button'],
    guidance: [
      'Mostly paragraphs. No headings or dividers.',
      'At most one photo, as the very first or the very last block, never in the middle.',
      'The first block after any photo is a paragraph.',
      'Sign off in the last paragraph, such as "Thank you," then your name and office.',
      'At most one button, drawn as a quiet link, and only when the goal has a clear online action such as signing up, donating, RSVPing or volunteering through a link.',
    ],
    starterBlocks: [
      { type: 'paragraph', text: '' },
      { type: 'paragraph', text: '' },
      { type: 'paragraph', text: '' },
    ],
  },
  // The fixed email: every part optional but the first text, never
  // reordered. Its blocks are checked against `structure`, and only it takes
  // a second photo and the signature.
  photo_letter: {
    label: 'Letter with photos',
    description:
      'A fixed letter: a photo, a headline, your message in two parts with a photo between them, a button and your signature.',
    defaultTheme: 'cyan',
    usualBlocks: ['image', 'heading', 'paragraph', 'paragraph', 'signature'],
    structure: [
      'image',
      'heading',
      'paragraph',
      'image',
      'paragraph',
      'button',
      'signature',
    ],
    guidance: [
      'The order is fixed: photo, level 1 heading, paragraph, photo, paragraph, button, signature. Every part is optional except the first paragraph, and none repeats.',
      'At most two photos: one at the top and one between the two paragraphs.',
      'No level 2 headings and no dividers.',
      'The two paragraphs read as one message: the second continues the first without repeating it.',
      'At most one button, and only when the goal has a clear online action such as signing up, donating, RSVPing or volunteering through a link.',
      'Do not sign off in a paragraph: the signature block carries the name and office.',
    ],
    starterBlocks: [
      { type: 'image', url: '', alt: '' },
      { type: 'heading', text: '', level: 1 },
      { type: 'paragraph', text: '' },
      { type: 'image', url: '', alt: '' },
      { type: 'paragraph', text: '' },
      { type: 'button', label: '', url: '' },
      {
        type: 'signature',
        name: '',
        office: '',
        imageUrl: '',
        profileUrl: '',
      },
    ],
  },
} as const satisfies Record<string, EmailLayoutPreset>

export type EmailLayoutPresetKey = keyof typeof EMAIL_LAYOUT_PRESETS

export const EmailLayoutPresetKeySchema = z
  .enum(['short_cta', 'long_update', 'personal_letter', 'photo_letter'])
  .describe(
    (Object.keys(EMAIL_LAYOUT_PRESETS) as EmailLayoutPresetKey[])
      .map(
        (key) =>
          `${key}: ${EMAIL_LAYOUT_PRESETS[key].description} Usually: ${EMAIL_LAYOUT_PRESETS[key].usualBlocks.join(', ')}. ${EMAIL_LAYOUT_PRESETS[key].guidance.join(' ')}`,
      )
      .join('\n'),
  ) satisfies z.ZodType<EmailLayoutPresetKey>

// The presets the original editor offers. photo_letter has its own editor.
export const EMAIL_CLASSIC_LAYOUT_PRESETS = [
  'short_cta',
  'long_update',
  'personal_letter',
] as const satisfies readonly EmailLayoutPresetKey[]

export interface EmailBlocksIssue {
  message: string
  // A required block is still missing. The editor may save that; a send may
  // not.
  incomplete: boolean
}

const countOf = (
  blocks: readonly EmailBlockDraft[],
  type: EmailBlockType,
): number => blocks.filter((block) => block.type === type).length

// Whether the blocks fill the structure's slots in order, each slot once.
// Greedy matching is exact for an in-order subsequence.
const followsStructure = (
  blocks: readonly EmailBlockDraft[],
  structure: readonly EmailBlockType[],
): boolean => {
  let slot = 0
  for (const block of blocks) {
    const fits = (type: EmailBlockType | undefined) =>
      type === block.type && (block.type !== 'heading' || block.level === 1)
    while (slot < structure.length && !fits(structure[slot])) slot += 1
    if (slot === structure.length) return false
    slot += 1
  }
  return true
}

// The structure every layout shares. A layout's usual shape is guidance, never
// a reason to refuse an email, except in a preset with a fixed `structure`.
// Field rules live on the block schemas. Without a layout, the original
// presets' rules apply.
export const checkEmailBlocks = (
  blocks: readonly EmailBlockDraft[],
  layout?: EmailLayoutPresetKey,
): EmailBlocksIssue[] => {
  const issues: EmailBlocksIssue[] = []
  const preset: EmailLayoutPreset | undefined =
    layout === undefined ? undefined : EMAIL_LAYOUT_PRESETS[layout]
  const structure = preset?.structure
  if (structure === undefined) {
    if (countOf(blocks, 'image') > 1) {
      issues.push({ message: 'Use at most one photo', incomplete: false })
    }
    if (countOf(blocks, 'signature') > 0) {
      issues.push({
        message: 'Only a letter with photos takes a signature',
        incomplete: false,
      })
    }
  } else {
    if (countOf(blocks, 'image') > 2) {
      issues.push({ message: 'Use at most two photos', incomplete: false })
    }
    if (!followsStructure(blocks, structure)) {
      issues.push({
        message:
          'Keep the parts in order: photo, headline, text, photo, text, button, signature',
        incomplete: false,
      })
    }
  }
  if (countOf(blocks, 'button') > 1) {
    issues.push({ message: 'Use at most one button', incomplete: false })
  }
  if (countOf(blocks, 'paragraph') === 0) {
    issues.push({ message: 'Add a paragraph', incomplete: true })
  }
  return issues
}
