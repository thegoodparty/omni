import type { OutreachStatus } from '../generated/enums'

/**
 * Whether a send has actually gone out, as of `today` (yyyy-MM-dd, the
 * reader's local day). `scheduledFor` is the day it is set to go out, also
 * yyyy-MM-dd, or null for a send with no day.
 *
 * No column records when a send went out, so it is derived. Status alone is
 * not enough: a Serve text reads in_progress from the moment it is paid for
 * and handed to the sender, days before its scheduled day.
 */
export const outreachHasGoneOut = (
  send: { status: OutreachStatus | null; scheduledFor: string | null },
  today: string,
): boolean =>
  send.status === 'completed' ||
  (send.status === 'in_progress' &&
    (send.scheduledFor === null || send.scheduledFor <= today))
