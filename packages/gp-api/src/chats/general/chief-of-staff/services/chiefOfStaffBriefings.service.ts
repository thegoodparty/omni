import { Injectable } from '@nestjs/common'
import { Prisma } from '../../../../generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { DateFormats } from '@/shared/util/date.util'
import { formatInTimeZone } from 'date-fns-tz'
import { parseIsoDateAsUTC } from '@/shared/util/date.util'
import { BriefingListItem, BriefingReadProvider } from './briefingReadTools'

const isRecord = (
  value: Prisma.JsonValue | null,
): value is { [k: string]: Prisma.JsonValue } =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readMeetingName = (artifact: Prisma.JsonValue | null): string | null => {
  if (!isRecord(artifact)) return null
  const name = artifact['meeting_name']
  return typeof name === 'string' ? name : null
}

const readStatus = (artifact: Prisma.JsonValue | null): string | null => {
  if (!isRecord(artifact)) return null
  const status = artifact['briefing_status']
  return typeof status === 'string' ? status : null
}

// Reads the official's own briefings for the CoS read tools. Scoped to the
// elected office; returns the cached artifact JSONB (no S3 fetch).
@Injectable()
export class ChiefOfStaffBriefingsService extends createPrismaBase(
  MODELS.MeetingBriefing,
) {
  forElectedOffice(electedOfficeId: string): BriefingReadProvider {
    return {
      list: () => this.list(electedOfficeId),
      getByDate: (meetingDate: string) =>
        this.getByDate(electedOfficeId, meetingDate),
    }
  }

  private async list(electedOfficeId: string): Promise<BriefingListItem[]> {
    const rows = await this.findMany({
      where: { electedOfficeId },
      orderBy: { meetingDate: Prisma.SortOrder.desc },
      select: { meetingDate: true, artifact: true },
    })
    return rows.map((row) => ({
      meetingDate: formatInTimeZone(
        row.meetingDate,
        'UTC',
        DateFormats.isoDate,
      ),
      meetingName: readMeetingName(row.artifact),
      status: readStatus(row.artifact),
    }))
  }

  private async getByDate(
    electedOfficeId: string,
    meetingDate: string,
  ): Promise<Prisma.JsonValue | null> {
    const row = await this.findFirst({
      where: {
        electedOfficeId,
        meetingDate: parseIsoDateAsUTC(meetingDate),
      },
      select: { artifact: true },
    })
    return row?.artifact ?? null
  }
}
