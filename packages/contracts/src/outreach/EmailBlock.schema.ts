import { z } from 'zod'
import {
  EMAIL_SUBJECT_MAX_LENGTH,
  EMAIL_URL_MAX_LENGTH,
} from './OutreachEmail.schema'

export const EMAIL_PREVIEW_TEXT_MAX_LENGTH = 140
export const EMAIL_HEADING_MAX_LENGTH = 120
export const EMAIL_PARAGRAPH_MAX_LENGTH = 2000
export const EMAIL_IMAGE_ALT_MAX_LENGTH = 150
export const EMAIL_BLOCK_BUTTON_LABEL_MAX_LENGTH = 40
export const EMAIL_SIGNATURE_NAME_MAX_LENGTH = 80
export const EMAIL_SIGNATURE_TITLE_MAX_LENGTH = 120
export const EMAIL_MAX_BLOCKS = 30
// Every text field summed, so thirty full blocks can't make a 60,000
// character email. Room for a long update of about 2,500 words.
export const EMAIL_CONTENT_TEXT_MAX_LENGTH = 15_000

// gp-api's renderer keeps exactly these two as SES (Handlebars) variables and
// escapes any other brace, so `{{city}}` or `{{ first_name }}` would reach the
// reader as typed. Rejecting them here tells the author (or agent) instead.
export const EMAIL_MERGE_TAGS = ['{{first_name}}', '{{last_name}}'] as const

const MERGE_TAG_HINT =
  'Only {{first_name}} and {{last_name}} can be merged, written exactly like that'

const MERGE_TAG_NOTE =
  ' To greet each reader by name, write {{first_name}} or {{last_name}} exactly like that; no other {{tags}} work.'

const hasOnlyKnownMergeTags = (value: string): boolean => {
  const rest = EMAIL_MERGE_TAGS.reduce(
    (text, tag) => text.replaceAll(tag, ''),
    value,
  )
  return !rest.includes('{{') && !rest.includes('}}')
}

const HTML_TAG_PATTERN = /<\/?[a-z][a-z0-9-]*(\s[^<>]*)?\/?>|<!--/i

// Draft mode is what the editor saves and previews while the author is still
// typing: every text and URL may be empty, but nothing may be too long or
// malformed. Final mode is what can be sent, and what an agent must return.
type Mode = 'final' | 'draft'

const text = (mode: Mode, max: number, multiline: boolean) => {
  const base = z
    .string()
    .trim()
    .max(max)
    .refine(hasOnlyKnownMergeTags, MERGE_TAG_HINT)
    .refine(
      (value) => !HTML_TAG_PATTERN.test(value),
      'Plain text only, without HTML tags',
    )
    .refine(
      (value) => multiline || !/[\r\n\u2028\u2029]/.test(value),
      'Keep this to one line',
    )
  return mode === 'final' ? base.min(1, 'This can’t be empty') : base
}

const isHttpsUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

const url = (mode: Mode) =>
  z
    .string()
    .trim()
    .max(EMAIL_URL_MAX_LENGTH)
    .refine(
      (value) => (mode === 'draft' && value === '') || isHttpsUrl(value),
      'Links must start with https://',
    )

const blockSchemas = (mode: Mode) => {
  const heading = z
    .object({
      type: z.literal('heading'),
      text: text(mode, EMAIL_HEADING_MAX_LENGTH, false).describe(
        'The heading, one line, plain text. Short and specific, like a newspaper headline.' +
          MERGE_TAG_NOTE,
      ),
      level: z
        .union([z.literal(1), z.literal(2)])
        .describe(
          '1 for the main headline at the top of the email, 2 for a smaller heading further down.',
        ),
    })
    .strict()
    .describe('A headline. Level 1 is the big one at the top.')

  const paragraph = z
    .object({
      type: z.literal('paragraph'),
      text: text(mode, EMAIL_PARAGRAPH_MAX_LENGTH, true).describe(
        'Plain text. A single line break starts a new line and a blank line starts a new paragraph. No HTML, no markdown (no **, #, or [links]); put a link in a button.' +
          MERGE_TAG_NOTE,
      ),
    })
    .strict()
    .describe('Body text. Write the way you would talk to a neighbor.')

  const image = z
    .object({
      type: z.literal('image'),
      url: url(mode).describe(
        'An https link to an image the sender uploaded. Never invent or guess an image URL; leave the image out if none was provided.',
      ),
      alt: text(mode, EMAIL_IMAGE_ALT_MAX_LENGTH, false).describe(
        'What the image shows, for people who can’t see it. One short sentence, like "Volunteers cleaning up Riverside Park".',
      ),
    })
    .strict()
    .describe('A full-width photo.')

  const button = z
    .object({
      type: z.literal('button'),
      label: text(mode, EMAIL_BLOCK_BUTTON_LABEL_MAX_LENGTH, false).describe(
        'What happens when they tap it, as a verb and an object: "RSVP for the town hall", "Take the survey". Never "Click here" or "Submit".',
      ),
      url: url(mode).describe(
        'The https link the button opens. Use only a link the sender gave you.',
      ),
    })
    .strict()
    .describe(
      'A button that opens a link. Use one per email, for the main ask.',
    )

  const signature = z
    .object({
      type: z.literal('signature'),
      name: text(mode, EMAIL_SIGNATURE_NAME_MAX_LENGTH, false).describe(
        'The sender’s name as they sign it, like "Maria Lopez".',
      ),
      title: text(mode, EMAIL_SIGNATURE_TITLE_MAX_LENGTH, false).describe(
        'The line under the name, like "Candidate for City Council, Ward 3" or "Mayor of Riverton".',
      ),
      photoUrl: url(mode)
        .optional()
        .describe(
          'An optional https link to a headshot the sender uploaded. Never invent one.',
        ),
    })
    .strict()
    .describe('The sign-off at the end of the email.')

  const divider = z
    .object({ type: z.literal('divider') })
    .strict()
    .describe('A thin line between parts of a long email.')

  return z
    .discriminatedUnion('type', [
      heading,
      paragraph,
      image,
      button,
      signature,
      divider,
    ])
    .describe('One block of the email. `type` decides which fields it takes.')
}

export const EmailBlockSchema = blockSchemas('final')
export type EmailBlock = z.infer<typeof EmailBlockSchema>
export type EmailBlockType = EmailBlock['type']

// The editor's in-progress shape: same blocks, but text and links may be
// empty. Never sent.
export const EmailBlockDraftSchema = blockSchemas('draft')
export type EmailBlockDraft = z.infer<typeof EmailBlockDraftSchema>

export const EMAIL_BLOCK_TYPES = [
  'heading',
  'paragraph',
  'image',
  'button',
  'signature',
  'divider',
] as const satisfies readonly EmailBlockType[]

export const emailSubjectSchema = (mode: Mode) =>
  text(mode, EMAIL_SUBJECT_MAX_LENGTH, false).describe(
    'The subject line. Under about 60 characters reads best on a phone. Specific, not salesy; no ALL CAPS or emoji strings.' +
      MERGE_TAG_NOTE,
  )

export const emailPreviewTextSchema = (mode: Mode) =>
  text(mode, EMAIL_PREVIEW_TEXT_MAX_LENGTH, false).describe(
    'Optional. The gray line inbox apps show after the subject. One sentence that adds to the subject instead of repeating it.',
  )

// Characters of reader-visible text in a block, for the whole-email budget.
export const emailBlockTextLength = (block: EmailBlockDraft): number => {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      return block.text.length
    case 'image':
      return block.alt.length
    case 'button':
      return block.label.length
    case 'signature':
      return block.name.length + block.title.length
    case 'divider':
      return 0
  }
}
