import Link from 'next/link'
import { format } from 'date-fns'
import { Badge } from '@styleguide'
import type { DoorKnockOutcome, SupportAnswer } from '@goodparty_org/contracts'
import { useUser } from '@shared/hooks/useUser'
import type {
  ContactStatusField,
  DoorKnockConstituentActivity,
  RobocallConstituentActivity,
  StatusChangeConstituentActivity,
  TextConstituentActivity,
} from '../shared/contacts-types'

// Shared with PersonOverlay's OUTREACH/POLL rows so the two files don't carry
// independent copies of the same date formatting (PersonOverlay imports this
// rather than redefining it, avoiding a circular import back into this file).
export const formatDateTime = (dateStr: string): string => {
  const d = new Date(dateStr)
  return format(d, "EEEE, MMMM d, yyyy, 'at' h:mm a")
    .replace(' AM', ' a.m.')
    .replace(' PM', ' p.m.')
}

const DOOR_KNOCK_OUTCOME_LABELS: Record<DoorKnockOutcome, string> = {
  answered: 'Answered',
  not_home: 'Not Home',
  refused_to_engage: 'Refused to Engage',
  inaccessible: 'Inaccessible',
  not_a_voter: 'Not a Voter',
}

const SUPPORT_ANSWER_LABELS: Record<SupportAnswer, string> = {
  supporter: 'Supporter',
  unsure: 'Unsure',
  non_supporter: 'Non-supporter',
}

// The field's own display name — a fixed 2-value title, not part of what
// resolveContactStatusLabel resolves server-side (that's the fromValue/
// toValue vocabulary, a different and larger axis).
const STATUS_CHANGE_FIELD_LABELS: Record<ContactStatusField, string> = {
  voter_likelihood: 'Voter Likelihood',
  support_status: 'Support Status',
}

// No per-outreach detail route exists in this app (app/dashboard/outreach has
// no [id] page) — link to the outreach list with ?outreachId= so the page
// scrolls to and highlights that campaign's row (ENG-10769; consumed and
// stripped by OutreachTable).
const outreachHref = (outreachId: number): string =>
  `/dashboard/outreach?outreachId=${outreachId}`

const ManualBadge: React.FC = () => (
  <Badge variant="soft" shape="pill">
    Manual
  </Badge>
)

const ActivityNote: React.FC<{ note: string | null }> = ({ note }) =>
  note ? (
    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{note}</p>
  ) : null

export const DoorKnockActivityRow: React.FC<{
  activity: DoorKnockConstituentActivity
}> = ({ activity }) => (
  <div className="flex flex-col gap-1 mb-3">
    <div className="flex items-center gap-2">
      <p className="text-sm font-semibold text-foreground">
        {/* Responses aren't Zod-parsed client-side — an enum value newer
            than this build must render as itself, not a blank. */}
        Door Knock:{' '}
        {DOOR_KNOCK_OUTCOME_LABELS[activity.data.outcome] ??
          activity.data.outcome}
      </p>
      {activity.data.manual ? <ManualBadge /> : null}
    </div>
    {activity.data.supportAnswer ? (
      <p className="text-sm font-normal text-muted-foreground">
        Support:{' '}
        {SUPPORT_ANSWER_LABELS[activity.data.supportAnswer] ??
          activity.data.supportAnswer}
      </p>
    ) : null}
    <ActivityNote note={activity.data.note} />
    <p className="text-sm font-normal text-muted-foreground">
      {formatDateTime(activity.date)}
    </p>
  </div>
)

export const TextActivityRow: React.FC<{
  activity: TextConstituentActivity
}> = ({ activity }) => (
  <div className="flex flex-col gap-1 mb-3">
    <div className="flex items-center gap-2">
      <p className="text-sm font-semibold text-foreground">Text</p>
      {activity.data.manual ? <ManualBadge /> : null}
    </div>
    <div className="flex flex-col text-sm font-normal text-muted-foreground">
      {activity.data.respondedAt ? (
        <p>Responded {formatDateTime(activity.data.respondedAt)}</p>
      ) : null}
      {activity.data.optedOutAt ? (
        <p>Opted out {formatDateTime(activity.data.optedOutAt)}</p>
      ) : null}
    </div>
    <ActivityNote note={activity.data.note} />
    <p className="text-sm font-normal text-muted-foreground">
      {formatDateTime(activity.date)}
    </p>
    {activity.data.outreachId ? (
      <Link
        className="text-sm font-medium text-info underline"
        href={outreachHref(activity.data.outreachId)}
      >
        View outreach
      </Link>
    ) : null}
  </div>
)

export const RobocallActivityRow: React.FC<{
  activity: RobocallConstituentActivity
}> = ({ activity }) => (
  <div className="flex flex-col gap-1 mb-3">
    <div className="flex items-center gap-2">
      <p className="text-sm font-semibold text-foreground">Robocall</p>
      {activity.data.manual ? <ManualBadge /> : null}
    </div>
    <div className="flex flex-col text-sm font-normal text-muted-foreground">
      {activity.data.answeredAt ? (
        <p>Answered {formatDateTime(activity.data.answeredAt)}</p>
      ) : null}
      {activity.data.voicemailLeftAt ? (
        <p>Voicemail left {formatDateTime(activity.data.voicemailLeftAt)}</p>
      ) : null}
      {!activity.data.answeredAt && !activity.data.voicemailLeftAt ? (
        <p>No answer</p>
      ) : null}
    </div>
    <ActivityNote note={activity.data.note} />
    <p className="text-sm font-normal text-muted-foreground">
      {formatDateTime(activity.date)}
    </p>
    {activity.data.outreachId ? (
      <Link
        className="text-sm font-medium text-info underline"
        href={outreachHref(activity.data.outreachId)}
      >
        View outreach
      </Link>
    ) : null}
  </div>
)

// Win-only (the feed itself never returns this type for a Serve context —
// gated server-side and again in the ActivitiesContent switch). "You" when
// the viewing user made the change; actorName (or a graceful "Someone" when
// neither is available — a future non-manual source with no actor) covers
// everyone else. fromLabel null is the never-seen-before edge: no prior
// override row existed for this (org, personId, field).
export const StatusChangeActivityRow: React.FC<{
  activity: StatusChangeConstituentActivity
}> = ({ activity }) => {
  const [user] = useUser()
  const isViewer = user != null && user.id === activity.data.actorUserId
  const actor = isViewer ? 'You' : (activity.data.actorName ?? 'Someone')
  const fieldLabel = STATUS_CHANGE_FIELD_LABELS[activity.data.field]
  const valueClause =
    activity.data.fromLabel === null
      ? `to '${activity.data.toLabel}'`
      : `from '${activity.data.fromLabel}' to '${activity.data.toLabel}'`
  const verb = activity.data.fromLabel === null ? 'set' : 'changed'

  return (
    <div className="flex flex-col gap-1 mb-3">
      <p className="text-sm font-semibold text-foreground">
        {fieldLabel} updated
      </p>
      <p className="text-sm font-normal text-muted-foreground">
        {actor} {verb} {fieldLabel} {valueClause}
      </p>
      <p className="text-sm font-normal text-muted-foreground">
        {formatDateTime(activity.date)}
      </p>
    </div>
  )
}
