import { Injectable } from '@nestjs/common'
import { parsePhoneNumberWithError } from 'libphonenumber-js'
import { PinoLogger } from 'nestjs-pino'
import { PrismaService } from '../../../prisma/prisma.service'

@Injectable()
export class SmsOptOutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SmsOptOutService.name)
  }

  /**
   * Records (or clears) an SMS opt-out for whoever we texted at this number.
   *
   * Resolution goes through `MagicLink.phone` rather than `User.phone` because
   * that is the number we actually sent to, already normalized to E.164 by
   * SmsService — `User.phone` is a free-text, unverified field that may hold any
   * format. Every user we texted at the number is updated: a shared or reassigned
   * number should suppress all of them, since erring toward not texting is the
   * cheap direction.
   */
  async setOptedOut(rawPhone: string, optedOut: boolean): Promise<number> {
    let phone: string
    try {
      phone = parsePhoneNumberWithError(rawPhone, 'US').number
    } catch {
      this.logger.warn(
        { rawPhone },
        'Ignoring SMS opt-out for an unparseable number',
      )
      return 0
    }

    const links = await this.prisma.magicLink.findMany({
      where: { phone },
      select: { userId: true },
    })
    const userIds = [...new Set(links.map((l) => l.userId))]

    if (userIds.length === 0) {
      // Worth a warning: a STOP we cannot attribute means we may keep texting
      // this number if it is later attached to a new lead.
      this.logger.warn(
        { phone },
        'Received an SMS opt-out for a number with no texted magic link',
      )
      return 0
    }

    const { count } = await this.prisma.user.updateMany({
      where: { id: { in: userIds } },
      data: { smsOptedOutAt: optedOut ? new Date() : null },
    })

    this.logger.info({ phone, optedOut, count }, 'Recorded SMS opt-out change')
    return count
  }
}
