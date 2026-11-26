import { Injectable } from '@nestjs/common'
import { formatInTimeZone } from 'date-fns-tz'
import type { StatedFirstMeeting } from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { DateFormats, parseIsoDateAsUTC } from '@/shared/util/date.util'

/**
 * The first meeting an official gave when the schedule's was wrong. The
 * meetings list, the briefing read and the briefing dispatch all read it, so
 * the day they corrected is the day they are briefed for.
 */
@Injectable()
export class StatedFirstMeetingService extends createPrismaBase(
  MODELS.StatedFirstMeeting,
) {
  async forOffice(electedOfficeId: string): Promise<StatedFirstMeeting | null> {
    const row = await this.model.findUnique({ where: { electedOfficeId } })
    return row
      ? {
          meetingDate: formatInTimeZone(
            row.meetingDate,
            'UTC',
            DateFormats.isoDate,
          ),
          meetingTime: row.meetingTime,
        }
      : null
  }

  async set(
    electedOfficeId: string,
    { meetingDate, meetingTime }: StatedFirstMeeting,
  ): Promise<StatedFirstMeeting> {
    const data = { meetingDate: parseIsoDateAsUTC(meetingDate), meetingTime }
    await this.model.upsert({
      where: { electedOfficeId },
      create: { electedOfficeId, ...data },
      update: data,
    })
    return { meetingDate, meetingTime }
  }

  async clear(electedOfficeId: string): Promise<void> {
    await this.model.deleteMany({ where: { electedOfficeId } })
  }
}
