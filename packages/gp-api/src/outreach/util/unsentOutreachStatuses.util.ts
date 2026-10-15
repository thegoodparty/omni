import { OutreachStatus } from '../../generated/prisma'

// A text past checkout is any status but these. The same statuses the
// priority flow counts as sent. The Chief of Staff reads the build card's
// invite as sent off this same list.
export const UNSENT_OUTREACH_STATUSES = [
  OutreachStatus.pending_payment,
  OutreachStatus.draft,
  OutreachStatus.canceled,
  OutreachStatus.denied,
  OutreachStatus.failed,
]
