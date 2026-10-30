import { z } from 'zod'
import {
  EMAIL_CONTENT_TEXT_MAX_LENGTH,
  EMAIL_MAX_BLOCKS,
  EMAIL_MAX_SECTIONS,
  EmailBlockDraftSchema,
  EmailBlockSchema,
  emailBlockTextLength,
  emailPreviewTextSchema,
  emailSubjectSchema,
  type EmailBlockDraft,
} from './EmailBlock.schema'
import {
  EmailLayoutPresetKeySchema,
  checkEmailLayout,
  type EmailLayoutPresetKey,
} from './EmailLayoutPreset.const'
import { EmailThemeKeySchema } from './EmailTemplate.const'

interface ContentShape {
  layout: EmailLayoutPresetKey
  subject: string
  previewText?: string
  blocks: readonly EmailBlockDraft[]
}

const checkContent = (data: ContentShape, ctx: z.RefinementCtx) => {
  const sections = data.blocks.filter((block) => block.type === 'section')
  if (sections.length > EMAIL_MAX_SECTIONS) {
    ctx.addIssue({
      code: 'custom',
      path: ['blocks'],
      message: `Use at most ${EMAIL_MAX_SECTIONS} sections`,
    })
  }
  const textLength =
    data.subject.length +
    (data.previewText?.length ?? 0) +
    data.blocks.reduce((sum, block) => sum + emailBlockTextLength(block), 0)
  if (textLength > EMAIL_CONTENT_TEXT_MAX_LENGTH) {
    ctx.addIssue({
      code: 'custom',
      path: ['blocks'],
      message: `Keep the whole email under ${EMAIL_CONTENT_TEXT_MAX_LENGTH.toLocaleString('en-US')} characters`,
    })
  }
  for (const issue of checkEmailLayout(data.layout, data.blocks)) {
    ctx.addIssue({
      code: 'custom',
      path:
        issue.blockIndex === null ? ['blocks'] : ['blocks', issue.blockIndex],
      message: issue.message,
    })
  }
}

const blocksDescription = `The email body, top to bottom. 1 to ${EMAIL_MAX_BLOCKS} blocks, following the layout's rules. Don't add a footer, unsubscribe link, address or "paid for by" line: the system adds those to every email.`

// What can be sent, and what an agent drafting an email must return. The
// footer (paid-for-by, postal address, why they're getting it, unsubscribe)
// is not content: gp-api adds it to every send so it can't be removed.
export const EmailContentSchema = z
  .object({
    layout: EmailLayoutPresetKeySchema,
    theme: EmailThemeKeySchema.describe(
      'The color theme. Any theme works with any layout.',
    ),
    subject: emailSubjectSchema('final'),
    previewText: emailPreviewTextSchema('final').optional(),
    blocks: z
      .array(EmailBlockSchema)
      .min(1)
      .max(EMAIL_MAX_BLOCKS)
      .describe(blocksDescription),
  })
  .strict()
  .superRefine(checkContent)
  .describe(
    'An outreach email: a layout, a color theme, a subject and an ordered list of content blocks.',
  )
export type EmailContent = z.infer<typeof EmailContentSchema>

// The editor's save and live-preview shape: the same structure rules, but any
// text or link may still be empty.
export const EmailContentDraftSchema = z
  .object({
    layout: EmailLayoutPresetKeySchema,
    theme: EmailThemeKeySchema,
    subject: emailSubjectSchema('draft'),
    previewText: emailPreviewTextSchema('draft').optional(),
    blocks: z.array(EmailBlockDraftSchema).max(EMAIL_MAX_BLOCKS),
  })
  .strict()
  .superRefine(checkContent)
export type EmailContentDraft = z.infer<typeof EmailContentDraftSchema>
