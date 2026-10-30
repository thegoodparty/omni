import { Injectable } from '@nestjs/common'
import {
  EMAIL_LAYOUTS,
  EmailPreviewRequest,
  EmailPreviewResponse,
} from '@goodparty_org/contracts'
import { EmailSendScope } from '../emailOutreach.types'
import { EMAIL_VARIABLES } from '../templates/emailTemplate.const'
import { renderEmailTemplate } from '../templates/renderEmailTemplate'
import { assertEmailImageUrl } from './outreachEmailImage.service'
import { OutreachEmailSenderService } from './outreachEmailSender.service'

const SAMPLE_VALUES: Record<string, string> = {
  [EMAIL_VARIABLES.firstName]: 'Alex',
  [EMAIL_VARIABLES.lastName]: 'Rivera',
  [EMAIL_VARIABLES.unsubscribeUrl]: '#',
}

const PLACEHOLDER_BUTTON = { label: 'Your button', url: 'https://example.com' }

@Injectable()
export class OutreachEmailPreviewService {
  constructor(private readonly senders: OutreachEmailSenderService) {}

  // The same render a send uses, with the recipient variables filled in. It
  // writes nothing and sends nothing.
  async render(
    scope: EmailSendScope,
    input: EmailPreviewRequest,
  ): Promise<EmailPreviewResponse> {
    assertEmailImageUrl(scope, input.imageUrl)
    const typedButton =
      input.buttonLabel?.trim() && input.buttonUrl
        ? { label: input.buttonLabel, url: input.buttonUrl }
        : null
    const button =
      typedButton ??
      (EMAIL_LAYOUTS[input.layout].requiresButton ? PLACEHOLDER_BUTTON : null)
    const { html } = await renderEmailTemplate(input.layout, input.theme, {
      subject: input.subject,
      headline: input.headline?.trim() || null,
      body: input.body,
      imageUrl: input.imageUrl ?? null,
      button,
      footer: {
        senderName: await this.senders.displayNameFor(scope),
        paidForBy: scope.paidForBy,
      },
    })
    return {
      html: html.replace(
        /\{\{(first_name|last_name|unsubscribe_url)\}\}/g,
        (_, name: string) => SAMPLE_VALUES[name] ?? '',
      ),
    }
  }
}
