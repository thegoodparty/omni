import { addDays, format, max, parseISO, startOfWeek } from 'date-fns'
import { fromZonedTime } from 'date-fns-tz'
import {
  nextManagedSendDate,
  SERVE_SMS_SEND_HOUR_LOCAL,
} from '@/outreach/services/outreachServeSmsCreate.service'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'

// The waves run over about two weeks from the first send.
const BUILD_DAYS = 14

// When the first invites go out and the Monday of the week the panel should
// be ready, as yyyy-MM-dd days: the first wave's own send date once it has
// one, so a panel whose wave was dated under an earlier rule shows that day,
// else the send date a wave drawn at approval gets; and about two weeks of
// waves after it.
export const managedPanelSchedule = (
  approvedAt: Date,
  firstWaveSendDate: string | null = null,
): { firstSendDate: string; readyWeekOf: string } => {
  const firstSendDate = firstWaveSendDate ?? nextManagedSendDate(approvedAt)
  const readyWeek = startOfWeek(addDays(parseISO(firstSendDate), BUILD_DAYS), {
    weekStartsOn: 1,
  })
  return { firstSendDate, readyWeekOf: format(readyWeek, 'yyyy-MM-dd') }
}

// The day the next wave goes out: the send date the wave job will give it
// once the latest wave's replies close (or now, if they already have). Held
// at 11am Eastern so it reads as that calendar day in every US zone.
export const managedPanelNextWaveAt = (
  replyWindowEndsAt: Date,
  now: Date,
): Date =>
  fromZonedTime(
    `${nextManagedSendDate(max([replyWindowEndsAt, now]))}T${SERVE_SMS_SEND_HOUR_LOCAL}:00:00`,
    EASTERN_TIMEZONE,
  )
