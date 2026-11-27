import { describe, expect, it } from 'vitest'
import {
  EMAIL_CONTENT_EXAMPLES,
  type EmailContent,
} from '@goodparty_org/contracts'
import type { EmailTemplateContext } from './emailTemplate.types'
import { renderEmailTemplate } from './renderEmailTemplate'

// Sent and saved emails store only their content, so a change to the
// renderer must never move a byte of an email in the original three presets.
const CLASSIC_EXAMPLES: [string, EmailContent][] = (
  ['short_cta', 'long_update', 'personal_letter'] as const
).flatMap((layout) =>
  (['win', 'serve'] as const).map((mode): [string, EmailContent] => [
    `${layout} ${mode}`,
    EMAIL_CONTENT_EXAMPLES[layout][mode],
  ]),
)

const CONTEXT: EmailTemplateContext = {
  senderName: 'Renee Wells',
  paidForBy: 'Wells for Mayor',
  sendDate: new Date('2026-11-03T17:00:00Z'),
}

describe('renderEmailTemplate, original presets', () => {
  it.each(CLASSIC_EXAMPLES)(
    'renders the %s example unchanged',
    async (_name, content) => {
      expect(await renderEmailTemplate(content, CONTEXT)).toMatchSnapshot()
    },
  )
})
