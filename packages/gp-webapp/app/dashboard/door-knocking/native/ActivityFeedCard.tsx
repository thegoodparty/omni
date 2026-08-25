import { RouteTargetActivity } from '@goodparty_org/contracts'
import { HistoryIcon } from '@styleguide'
import {
  DoorKnockActivityRow,
  PhoneBankingActivityRow,
  RobocallActivityRow,
  StatusChangeActivityRow,
  TextActivityRow,
} from 'app/dashboard/contacts/crm/person/ActivityFeedEntry'
import SheetSectionHeader from './SheetSectionHeader'

// ADR 0009. What this campaign already did to this resident, newest first,
// read off the route payload rather than fetched — the sheet has to render a
// block into a walk with no signal, which is the ordinary case rather than the
// edge one.
//
// The rows are the CRM person view's own, imported rather than reimplemented.
// A do_not_knock or not_a_voter event that reads one way in Contacts and
// another at the door is a bug nobody notices until a candidate is holding
// both, and resolveContactStatusLabel already owns that vocabulary.
//
// Only dated, attributed events belong here. `mayHaveMoved` deliberately does
// not: it is a voter-file quality hint with no timestamp and no actor, so
// putting it in a timeline would invent both. It stays a line in Contact
// information, which matters because it can co-occur with a canvasser's
// firsthand `notAVoterReason: 'moved'` — and that one does appear here, as a
// dated status change naming who recorded it. Two different observations of
// the same house corroborating each other, in two different registers; one
// event logged twice is what it would look like if the hint were forced into
// the feed as a row.
// The door's feed carries no navigation. `TextActivityRow` and
// `RobocallActivityRow` render a "View outreach" link whenever `outreachId` is
// set — the common case for a campaign text — and at a desk that is right,
// while mid-walk it is a same-tab route change out of the walk. Everything
// else that leaves this page opens in a new tab for that reason (the printed
// sheet, Open in Maps), because unmounting `WalkView` discards the per-target
// replay keys that let a retried knock upsert instead of duplicating.
//
// Dropping the id here rather than adding a prop to the shared row keeps the
// Contacts view exactly as it was; the linked entry is one tap away there. The
// id is presentational in these rows and nothing else on this surface reads
// it, so this narrows what is drawn without inventing anything.
// Narrowed one variant at a time: a combined `TEXT || ROBOCALL` test widens
// `data` back to the union and the spread stops type-checking.
//
// `PHONE_BANKING` needs no case: its row renders no outreach link, so there is
// nothing here to strip. Should one ever be added there, it needs one here too.
const withoutOutreachLinks = (
  activity: RouteTargetActivity,
): RouteTargetActivity => {
  switch (activity.type) {
    case 'TEXT':
      return { ...activity, data: { ...activity.data, outreachId: null } }
    case 'ROBOCALL':
      return { ...activity, data: { ...activity.data, outreachId: null } }
    default:
      return activity
  }
}

export default function ActivityFeedCard({
  history,
}: {
  history: RouteTargetActivity[]
}) {
  return (
    <section className="mb-4 rounded-lg border border-border">
      <SheetSectionHeader icon={HistoryIcon} title="Activity feed" />
      <div className="p-4 text-sm">
        {history.length === 0 ? (
          // Named as a fact about this resident, not the household: the
          // housemate on the tab beside them may well have been reached, and
          // the whole point of scoping the feed is that those are different
          // answers.
          <p className="text-muted-foreground">
            No previous outreach to this resident.
          </p>
        ) : (
          history.map(withoutOutreachLinks).map((activity) => {
            switch (activity.type) {
              case 'DOOR_KNOCK':
                return (
                  <DoorKnockActivityRow
                    key={activity.data.activityId}
                    activity={activity}
                  />
                )
              case 'TEXT':
                return (
                  <TextActivityRow
                    key={activity.data.activityId}
                    activity={activity}
                  />
                )
              case 'ROBOCALL':
                return (
                  <RobocallActivityRow
                    key={activity.data.activityId}
                    activity={activity}
                  />
                )
              case 'PHONE_BANKING':
                return (
                  <PhoneBankingActivityRow
                    key={activity.data.activityId}
                    activity={activity}
                  />
                )
              case 'STATUS_CHANGE':
                return (
                  <StatusChangeActivityRow
                    key={activity.data.activityId}
                    activity={activity}
                  />
                )
              default:
                // A variant added to RouteTargetActivity without a branch here
                // fails the build rather than dropping rows silently. satisfies
                // erases at runtime, so an unknown server type still has to
                // return null — React throws on an object child.
                void (activity satisfies never)
                return null
            }
          })
        )}
      </div>
    </section>
  )
}
