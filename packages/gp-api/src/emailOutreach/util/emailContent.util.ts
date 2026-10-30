import { BadRequestException } from '@nestjs/common'
import { z } from 'zod'
import {
  EmailContentDraftSchema,
  EmailContentSchema,
  EmailContentViewSchema,
  EmailLayoutKeySchema,
  EmailLayoutPresetKeySchema,
  EmailThemeKeySchema,
  checkEmailLayout,
  type EmailBlockDraft,
  type EmailContent,
  type EmailContentDraft,
  type EmailContentView,
  type EmailLayoutKey,
  type EmailLayoutPresetKey,
} from '@goodparty_org/contracts'
import { OutreachEmail } from '../../generated/prisma'

export type EmailFields = {
  headline: string | null
  body: string
  imageUrl: string | null
  buttonLabel: string | null
  buttonUrl: string | null
}

type FieldsDraft = EmailFields & {
  layout: string
  theme: string
  subject: string
}

type ContentRow = FieldsDraft & Pick<OutreachEmail, 'content'>

const PRESET_FOR_LAYOUT: Record<EmailLayoutKey, EmailLayoutPresetKey> = {
  newsletter: 'long_update',
  reminder: 'personal_letter',
  call_to_action: 'short_cta',
}

// The fixed fields never had alt text, and a sendable image needs some.
const FIELDS_IMAGE_ALT = 'Photo'

export const presetForLayout = (
  layout: EmailLayoutKey | EmailLayoutPresetKey,
): EmailLayoutPresetKey => {
  const parsed = EmailLayoutKeySchema.safeParse(layout)
  return parsed.success
    ? PRESET_FOR_LAYOUT[parsed.data]
    : EmailLayoutPresetKeySchema.parse(layout)
}

// Headline to heading, body to paragraphs, image, button, arranged the way
// the preset wants them. personal_letter has no headings, so its headline
// opens the letter as a paragraph.
export const fieldsToBlocks = (
  preset: EmailLayoutPresetKey,
  fields: EmailFields,
): EmailBlockDraft[] => {
  const headline = fields.headline?.trim() ?? ''
  const body = fields.body.trim()
  const paragraphs: EmailBlockDraft[] = body
    .split(/\n{2,}/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({ type: 'paragraph', text }))
  const image: EmailBlockDraft[] = fields.imageUrl
    ? [{ type: 'image', url: fields.imageUrl, alt: FIELDS_IMAGE_ALT }]
    : []
  const button: EmailBlockDraft[] = fields.buttonLabel
    ? [
        {
          type: 'button',
          label: fields.buttonLabel,
          url: fields.buttonUrl ?? '',
        },
      ]
    : []
  const heading: EmailBlockDraft[] = headline
    ? [{ type: 'heading', text: headline, level: 1 }]
    : []
  switch (preset) {
    case 'short_cta':
      return [
        ...image,
        ...heading,
        ...(body ? [{ type: 'paragraph' as const, text: body }] : []),
        ...button,
      ]
    case 'long_update':
      return [...heading, ...image, ...paragraphs, ...button]
    case 'personal_letter':
      return [
        ...image,
        ...(headline ? [{ type: 'paragraph' as const, text: headline }] : []),
        ...paragraphs,
        ...button,
      ]
  }
}

// A draft saved with the fixed fields takes its old layout's preset when its
// blocks fit it, structure and block limits both, and otherwise
// personal_letter, which takes any of them and turns a headline too long for
// a heading into a paragraph. The one thing no preset holds is a paragraph
// over the block limit; a save refuses that at compose.
export const fieldsContent = (row: FieldsDraft): EmailContentView => {
  const parsedLayout = EmailLayoutKeySchema.safeParse(row.layout)
  const natural = parsedLayout.success
    ? PRESET_FOR_LAYOUT[parsedLayout.data]
    : 'personal_letter'
  const theme = EmailThemeKeySchema.parse(row.theme)
  const naturalBlocks = fieldsToBlocks(natural, row)
  const fits =
    checkEmailLayout(natural, naturalBlocks).length === 0 &&
    EmailContentDraftSchema.safeParse({
      layout: natural,
      theme,
      subject: row.subject,
      blocks: naturalBlocks,
    }).success
  return {
    layout: fits ? natural : 'personal_letter',
    theme,
    subject: row.subject,
    blocks: fits ? naturalBlocks : fieldsToBlocks('personal_letter', row),
  }
}

export const emailContentOf = (row: ContentRow): EmailContentView =>
  row.content === null
    ? fieldsContent(row)
    : EmailContentViewSchema.parse(row.content)

const issueLabel = (path: PropertyKey[]): string =>
  path[0] === 'blocks' && typeof path[1] === 'number'
    ? `Block ${path[1] + 1}: `
    : path[0] === 'subject'
      ? 'Subject: '
      : ''

const issueMessage = (issue: z.core.$ZodIssue | undefined): string =>
  issue ? issueLabel(issue.path) + issue.message : ''

// What confirm, the test send and prepare send: the draft checked against
// the send schema, not the editor's looser one.
export const sendableContentOf = (row: ContentRow): EmailContent => {
  const result = EmailContentSchema.safeParse(emailContentOf(row))
  if (!result.success) {
    throw new BadRequestException(
      `Finish the email before sending it. ${issueMessage(result.error.issues[0])}`.trim(),
    )
  }
  return result.data
}

export const previewableContentOf = (
  content: EmailContentView,
): EmailContentDraft => {
  const result = EmailContentDraftSchema.safeParse(content)
  if (!result.success) {
    throw new BadRequestException(issueMessage(result.error.issues[0]))
  }
  return result.data
}
