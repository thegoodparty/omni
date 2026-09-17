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
   *
   * `eventAt` is the callback's signed timestamp, and it decides the outcome
   * rather than merely being stored — see the where clause below.
   */
  async setOptedOut(
    rawPhone: string,
    optedOut: boolean,
    eventAt: Date,
  ): Promise<number> {
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

    // Applied only if this callback is newer than the one behind the current
    // state. Sinch says outright that callback order is not guaranteed, so
    // without this a STOP that arrives after a later START — a slow retry, a
    // requeue — wins on arrival and silently un-subscribes someone who asked to
    // be texted again. It is also what stops a replay: a captured callback
    // carries its original timestamp forever, so replaying a STOP over a newer
    // START, or a START over a newer STOP, loses this comparison.
    //
    // `lt` and not `lte`: equal means we have already applied this exact
    // callback, which is what a Sinch retry of a delivery we did process looks
    // like. Skipping it is the idempotent answer, and the 2xx below still tells
    // Sinch to stop retrying.
    const { count } = await this.prisma.user.updateMany({
      where: {
        id: { in: userIds },
        OR: [{ smsOptEventAt: null }, { smsOptEventAt: { lt: eventAt } }],
      },
      // The event's own time, not `new Date()`. It is when the person actually
      // texted STOP, and it has to be the value compared against next time.
      data: {
        smsOptedOutAt: optedOut ? eventAt : null,
        smsOptEventAt: eventAt,
      },
    })

    if (count < userIds.length) {
      // Not an error: the common cause is a retry of something already applied.
      this.logger.info(
        { phone, optedOut, eventAt, applied: count, matched: userIds.length },
        'Skipped an inbound SMS opt-out change older than the recorded state',
      )
    }

    this.logger.info({ phone, optedOut, count }, 'Recorded SMS opt-out change')
    return count
  }
}
