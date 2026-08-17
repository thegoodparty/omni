import { RouteTargetActivity } from '@goodparty_org/contracts'
import {
  DoorKnockActivityRow,
  RobocallActivityRow,
  StatusChangeActivityRow,
  TextActivityRow,
} from 'app/dashboard/contacts/crm/person/ActivityFeedEntry'

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
export default function ActivityFeedCard({
  history,
}: {
  history: RouteTargetActivity[]
}) {
  return (
    <section className="mb-4 rounded-lg border border-border">
      <h3 className="border-b border-border px-4 py-3 text-sm font-semibold">
        Activity feed
      </h3>
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
          history.map((activity) => {
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
