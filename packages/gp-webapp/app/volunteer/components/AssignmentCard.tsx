import Link from 'next/link'
import { Button, Card } from '@styleguide'
import type { MyAssignment } from '@goodparty_org/contracts'
import {
  ChannelBadge,
  HistoryStatusText,
} from 'app/dashboard/outreach/v2/channelMeta'

// A separate vocabulary from historyStatus.util.ts's getHistoryStatusLabel:
// that helper resolves off a full Outreach row (p2pJob, phoneListId) this
// assignment row doesn't carry, so it can't be called with a MyAssignment
// without faking those fields. Same non-p2p label strings on purpose — they
// register into channelMeta.tsx's shared STATUS_DISPLAY icon/tone table, so
// staying on that vocabulary is what keeps a card's status looking like every
// other status in the app.
const STATUS_LABELS: Record<NonNullable<MyAssignment['status']>, string> = {
  pending: 'In review',
  approved: 'In review',
  denied: 'Denied',
  paid: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Done',
  pending_payment: 'Pending payment',
  canceled: 'Canceled',
  failed: "Couldn't send",
}

const statusLabel = (status: MyAssignment['status']): string =>
  status ? STATUS_LABELS[status] : 'Not started'

interface AssignmentAction {
  href: string
  label: string
}

// Canceled/denied/failed/completed work must not offer a "Continue" action;
// the assignments page groups these out of the active list with the same set.
// Typed against the contract enum so a new OutreachStatus member forces a
// grouped-or-active decision here instead of silently landing in active.
const TERMINAL_BY_STATUS: Record<
  NonNullable<MyAssignment['status']>,
  boolean
> = {
  pending_payment: false,
  pending: false,
  approved: false,
  paid: false,
  in_progress: false,
  completed: true,
  canceled: true,
  denied: true,
  failed: true,
}
export const isTerminalStatus = (status: MyAssignment['status']) =>
  status !== null && TERMINAL_BY_STATUS[status]

// Only the two native channels carry a channel-pointer to route to (their
// own future pages, ENG-11053's follow-ons) — every other assignable
// outreachType has neither block, so it renders with no primary action.
const resolveAction = (
  assignment: MyAssignment,
): { action: AssignmentAction | null; progress: string | null } => {
  if (isTerminalStatus(assignment.status)) {
    return { action: null, progress: null }
  }
  if (
    assignment.outreachType === 'nativePhoneBanking' &&
    assignment.phoneBanking
  ) {
    const { listId, peopleCalled, peopleTotal } = assignment.phoneBanking
    return {
      action: {
        href: `/volunteer/phone-banking/${listId}`,
        label: peopleCalled === 0 ? 'Call this list' : 'Continue calling',
      },
      progress: `${peopleCalled} of ${peopleTotal} people reached`,
    }
  }
  if (
    assignment.outreachType === 'nativeDoorKnocking' &&
    assignment.doorKnocking
  ) {
    const { turfId, loggedCount, peopleCount } = assignment.doorKnocking
    return {
      action: {
        href: `/volunteer/door-knocking/${turfId}`,
        label: loggedCount === 0 ? 'Walk this route' : 'Continue knocking',
      },
      progress: `${loggedCount} of ${peopleCount} people logged`,
    }
  }
  return { action: null, progress: null }
}

const AssignmentCard = ({
  assignment,
}: {
  assignment: MyAssignment
}): React.JSX.Element => {
  const { action, progress } = resolveAction(assignment)

  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <ChannelBadge type={assignment.outreachType} />
        <HistoryStatusText label={statusLabel(assignment.status)} />
      </div>
      <p className="m-0 truncate text-sm font-semibold text-foreground">
        {assignment.name ?? 'Untitled assignment'}
      </p>
      {progress && (
        <p className="m-0 text-sm text-muted-foreground">{progress}</p>
      )}
      {action && (
        <Button asChild size="small" variant="outline" className="w-fit">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      )}
    </Card>
  )
}

export default AssignmentCard
