import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common'
import { EmailTestSendResponse } from '@goodparty_org/contracts'
import { APP_ROOT } from '@/shared/util/appEnvironment.util'
import { OutreachStatus, User } from '../../generated/prisma'
import { EMAIL_OUTREACH_DOMAIN } from '../emailOutreach.const'
import { EmailSendScope } from '../emailOutreach.types'
import {
  EMAIL_VARIABLES,
  emailVariableToken,
} from '../templates/emailTemplate.const'
import {
  formatFrom,
  isBlockedByDevAllowlist,
  renderOutreachEmail,
} from '../util/renderOutreachEmail.util'
import { OutreachEmailService } from './outreachEmail.service'
import { SesService } from './ses.service'

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

@Injectable()
export class OutreachEmailTestService {
  constructor(
    private readonly emails: OutreachEmailService,
    private readonly ses: SesService,
  ) {}

  // Goes only to the user's login address, is never billed or counted toward
  // warming, and carries no outreachEmailId tag so it stays out of the send's
  // CloudWatch numbers.
  async sendTest(
    scope: EmailSendScope,
    outreachId: number,
    user: User,
  ): Promise<EmailTestSendResponse> {
    const row = await this.emails.findWithSenderOrThrow(scope, outreachId)
    if (row.outreach.status !== OutreachStatus.draft) {
      throw new ConflictException('Only a draft can be tested')
    }
    if (isBlockedByDevAllowlist(user.email)) {
      throw new BadRequestException(
        'Test emails here go only to team addresses',
      )
    }
    const rendered = await renderOutreachEmail(
      row,
      row.sender.displayName,
      row.outreach.date ?? new Date(),
    )
    const values: Record<string, string> = {
      [EMAIL_VARIABLES.firstName]: user.firstName ?? '',
      [EMAIL_VARIABLES.lastName]: user.lastName ?? '',
      [EMAIL_VARIABLES.unsubscribeUrl]: `${APP_ROOT}/email/unsubscribe/test-send`,
    }
    const fill = (template: string, encode: (v: string) => string): string =>
      Object.entries(values).reduce(
        (result, [name, value]) =>
          result.replaceAll(emailVariableToken(name), encode(value)),
        template,
      )
    await this.ses.sendEmail({
      from: formatFrom(
        row.sender.displayName,
        `${row.sender.localPart}@${EMAIL_OUTREACH_DOMAIN}`,
      ),
      to: user.email,
      subject: `[Test] ${fill(rendered.subject, (v) => v)}`,
      html: fill(rendered.html, escapeHtml),
      text: fill(rendered.text, (v) => v),
      tenantName: row.sender.sesTenantName ?? undefined,
    })
    return { sentTo: user.email }
  }
}
