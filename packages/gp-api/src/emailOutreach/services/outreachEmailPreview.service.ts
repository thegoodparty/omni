import { Injectable } from '@nestjs/common'
import {
  EmailPreviewRequest,
  EmailPreviewResponse,
} from '@goodparty_org/contracts'
import { EmailSendScope } from '../emailOutreach.types'
import { EMAIL_VARIABLES } from '../templates/emailTemplate.const'
import { renderEmailTemplate } from '../templates/renderEmailTemplate'
import { fieldsContent, previewableContentOf } from '../util/emailContent.util'
import { assertEmailImageUrl } from './outreachEmailImage.service'
import { OutreachEmailSenderService } from './outreachEmailSender.service'

const SAMPLE_VALUES: Record<string, string> = {
  [EMAIL_VARIABLES.firstName]: 'Alex',
  [EMAIL_VARIABLES.lastName]: 'Rivera',
  [EMAIL_VARIABLES.unsubscribeUrl]: '#',
}

@Injectable()
export class OutreachEmailPreviewService {
  constructor(private readonly senders: OutreachEmailSenderService) {}

  // The same render a send uses, with the recipient variables filled in and
  // today as the send date. It writes nothing and sends nothing.
  async render(
    scope: EmailSendScope,
    input: EmailPreviewRequest,
  ): Promise<EmailPreviewResponse> {
    const content =
      'content' in input
        ? input.content
        : previewableContentOf(
            fieldsContent({
              ...input,
              headline: input.headline ?? null,
              imageUrl: input.imageUrl ?? null,
              buttonLabel:
                input.buttonLabel?.trim() && input.buttonUrl
                  ? input.buttonLabel.trim()
                  : null,
              buttonUrl: input.buttonUrl ?? null,
            }),
          )
    for (const block of content.blocks) {
      if (block.type === 'image' && block.url) {
        assertEmailImageUrl(scope, block.url)
      }
    }
    const { html } = await renderEmailTemplate(content, {
      senderName: await this.senders.displayNameFor(scope),
      paidForBy: scope.paidForBy,
      sendDate: new Date(),
    })
    return {
      html: html.replace(
        /\{\{(first_name|last_name|unsubscribe_url)\}\}/g,
        (_, name: string) => SAMPLE_VALUES[name] ?? '',
      ),
    }
  }
}
