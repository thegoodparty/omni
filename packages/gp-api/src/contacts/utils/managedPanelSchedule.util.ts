import { addDays, format, parseISO, startOfWeek } from 'date-fns'
import { nextManagedSendDate } from '@/outreach/services/outreachServeSmsCreate.service'

// The waves run over about two weeks from the first send.
const BUILD_DAYS = 14

// When the first invites go out and the Monday of the week the panel should
// be ready, as yyyy-MM-dd days, from the day it was approved: the earliest
// day a Serve text can be sent, and about two weeks of waves after it.
export const managedPanelSchedule = (
  approvedAt: Date,
): { firstSendDate: string; readyWeekOf: string } => {
  const firstSendDate = nextManagedSendDate(approvedAt)
  const readyWeek = startOfWeek(addDays(parseISO(firstSendDate), BUILD_DAYS), {
    weekStartsOn: 1,
  })
  return { firstSendDate, readyWeekOf: format(readyWeek, 'yyyy-MM-dd') }
}
