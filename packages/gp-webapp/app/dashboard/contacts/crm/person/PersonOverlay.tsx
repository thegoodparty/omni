'use client'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Sheet,
  SheetContent,
  SheetTitle,
} from '@styleguide'
import Image from 'next/image'
import Link from 'next/link'
import {
  LuCircleCheck,
  LuCircleX,
  LuClipboardList,
  LuContact,
  LuDoorOpen,
  LuFolderOpen,
  LuFrown,
  LuMessageSquareMore,
  LuPhone,
  LuShare2,
  LuSmile,
} from 'react-icons/lu'
import { format } from 'date-fns'
import { useContactsTable } from '../ContactsTableProvider'
import {
  ConstituentActivity,
  OutreachChannel,
  OutreachConstituentActivity,
  Person,
  PollConstituentActivity,
} from '../shared/contacts-types'
import { isNotNil } from 'es-toolkit'
import { ReactNode, useEffect, useRef } from 'react'
import Map from '@shared/utils/Map'
import { useFlagOn } from '@shared/experiments/FeatureFlagsProvider'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'

export const formatPersonName = (person: Person) =>
  [person.firstName, person.lastName, person.nameSuffix]
    .filter(Boolean)
    .map((n) => n!.trim())
    .join(' ')

const formatDateTime = (dateStr: string): string => {
  const d = new Date(dateStr)
  return format(d, "EEEE, MMMM d, yyyy, 'at' h:mm a")
    .replace(' AM', ' a.m.')
    .replace(' PM', ' p.m.')
}

const ACTIVITY_EVENT_LABELS: Record<string, string> = {
  SENT: 'Sent',
  RESPONDED: 'Responded',
  OPTED_OUT: 'Opted Out',
}

// Honest send-time labels per channel. v1 outreach attribution is send-time
// (segmentDerived) for everything except door knocking (per-recipient), so the
// label says what we did, not what was delivered.
const OUTREACH_CHANNEL_LABELS: Record<OutreachChannel, string> = {
  text: 'Texted',
  p2p: 'Texted',
  doorKnocking: 'Knocked',
  phoneBanking: 'Called',
  robocall: 'Called',
  socialMedia: 'Digital',
}

const OUTREACH_CHANNEL_ICONS: Record<OutreachChannel, React.ReactNode> = {
  text: <LuMessageSquareMore size={16} className="shrink-0 text-foreground" />,
  p2p: <LuMessageSquareMore size={16} className="shrink-0 text-foreground" />,
  doorKnocking: <LuDoorOpen size={16} className="shrink-0 text-foreground" />,
  phoneBanking: <LuPhone size={16} className="shrink-0 text-foreground" />,
  robocall: <LuPhone size={16} className="shrink-0 text-foreground" />,
  socialMedia: <LuShare2 size={16} className="shrink-0 text-foreground" />,
}

const isOutreachActivity = (
  activity: ConstituentActivity,
): activity is OutreachConstituentActivity => activity.type === 'OUTREACH'

// ENG-10695 unioned ContactInteraction*/ContactNote entries into the feed
// response; this pre-CRM renderer only knew POLL_INTERACTIONS and OUTREACH,
// so a bare `else` on non-outreach entries would treat those new types as
// polls and crash reading activity.data.pollId. Rendering them is task 07's
// job — until then, skip anything that isn't one of the two known types.
const isPollActivity = (
  activity: ConstituentActivity,
): activity is PollConstituentActivity => activity.type === 'POLL_INTERACTIONS'

const OutreachActivityRow: React.FC<{
  activity: OutreachConstituentActivity
}> = ({ activity }) => (
  <div className="flex flex-col gap-1 mb-3">
    <div className="flex items-center gap-2">
      {OUTREACH_CHANNEL_ICONS[activity.data.outreachType]}
      <p className="text-sm font-semibold text-foreground">
        {OUTREACH_CHANNEL_LABELS[activity.data.outreachType]}
      </p>
      {activity.data.attributionSource === 'segmentDerived' ? (
        <p className="text-sm font-normal text-muted-foreground">
          Sent to segment
        </p>
      ) : null}
    </div>
    {activity.date ? (
      <p className="text-sm font-normal text-muted-foreground">
        {formatDateTime(activity.date)}
      </p>
    ) : null}
  </div>
)

const PollActivityRow: React.FC<{ activity: PollConstituentActivity }> = ({
  activity,
}) => (
  <div className="flex flex-col gap-1 mb-3">
    <Link
      className="font-medium text-info underline mb-2"
      href={`/dashboard/polls/${activity.data.pollId}`}
      target="_blank"
    >
      {activity.data.pollTitle}
    </Link>
    {activity.data.events?.length ? (
      <div className="mt-1 flex flex-col text-sm font-normal text-muted-foreground">
        {activity.data.events.map((evt, i) => {
          return (
            <div key={i} className="flex flex-col">
              <div className="flex items-center gap-2">
                {evt.type === 'SENT' && (
                  <LuCircleCheck
                    size={16}
                    className="shrink-0 text-foreground"
                  />
                )}
                {evt.type === 'RESPONDED' && (
                  <LuMessageSquareMore
                    size={16}
                    className="shrink-0 text-foreground"
                  />
                )}
                {evt.type === 'OPTED_OUT' && (
                  <LuCircleX size={16} className="shrink-0 text-foreground" />
                )}

                <p className="text-sm font-semibold text-foreground">
                  {ACTIVITY_EVENT_LABELS[evt.type] ?? evt.type}
                </p>
              </div>

              <div className="flex gap-2 h-7">
                <div className="flex items-center gap-2">
                  <div className="flex w-4 shrink-0 justify-center">
                    {i < activity.data.events.length - 1 ? (
                      <div className="h-5 w-px bg-border my-1" />
                    ) : null}
                  </div>
                </div>
                <p className="text-sm font-normal text-muted-foreground justify-self-start">
                  {evt.date ? formatDateTime(evt.date) : ''}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    ) : null}
  </div>
)

const InfoSection: React.FC<{
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}> = ({ title, icon, children }) => (
  <Card className="p-4">
    <div className="flex items-center justify-between">
      <CardTitle className="text-lg font-semibold">{title}</CardTitle>
      {icon}
    </div>
    <div className="flex flex-col gap-4">{children}</div>
  </Card>
)

const Field: React.FC<{ label: string; value: ReactNode | string | null }> = ({
  label,
  value,
}) => (
  <div className="flex flex-col gap-1">
    <p className="text-sm text-muted-foreground">{label}</p>
    <div className="text-md">{value ?? 'Unknown'}</div>
  </div>
)

const TopIssuesContent: React.FC = () => {
  const {
    currentlySelectedPerson: {
      issues,
      isLoadingIssues: isLoading,
      isErrorIssues: isError,
      issuesHasNextPage: hasNextPage,
      issuesFetchNextPage: onViewMore,
      isFetchingNextIssues: isFetchingNextPage,
    },
  } = useContactsTable()

  if (isError || issues.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3">
        <Image
          src="/images/dashboard/no-documents.svg"
          alt=""
          width={100}
          height={100}
          className="h-15 w-auto"
        />
        <p className="text-sm text-muted-foreground">Data not available.</p>
      </div>
    )
  }
  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-muted rounded animate-pulse" />
        ))}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-6">
      {issues.map((issue, idx) => (
        <div key={idx} className="flex flex-col gap-1">
          <Link
            className="font-medium text-info underline"
            href={`/dashboard/polls/${issue.pollId}`}
            target="_blank"
          >
            {issue.issueTitle}
          </Link>
          {issue.issueSummary ? (
            <p className="text-sm font-normal text-muted-foreground">
              {issue.issueSummary}
            </p>
          ) : null}
        </div>
      ))}
      {hasNextPage ? (
        <Button
          type="button"
          onClick={() => onViewMore()}
          disabled={isFetchingNextPage}
          variant="outline"
          className="mt-4"
        >
          {isFetchingNextPage ? 'Loading...' : 'View more'}
        </Button>
      ) : null}
    </div>
  )
}

const ActivitiesContent: React.FC = () => {
  const {
    currentlySelectedPerson: {
      activities,
      isLoadingActivities: isLoading,
      isErrorActivities: isError,
      activitiesHasNextPage: hasNextPage,
      activitiesFetchNextPage: onViewMore,
      isFetchingNextActivities: isFetchingNextPage,
    },
    currentlySelectedPersonId,
    isWinContext,
    isWinContextReady,
  } = useContactsTable()

  // ENG-10695 unioned in DOOR_KNOCK/TEXT/ROBOCALL/NOTE entries, but this
  // renderer only draws OUTREACH/POLL_INTERACTIONS rows (task 07 widens it).
  // Counting the new types here would show the empty state as if there were
  // renderable rows to draw (a blank feed instead of "Data not available")
  // and could fire the outreach-adoption event for a page with nothing on
  // screen.
  const renderableActivities = activities.filter(
    (activity) => isOutreachActivity(activity) || isPollActivity(activity),
  )
  const hasActivities = renderableActivities.length > 0

  // Fire once per opened person when the Win outreach timeline actually
  // renders rows (not while loading and not for an empty/error feed), so the
  // event answers "did a Win user see attributed outreach" rather than "did
  // the overlay open". Gate on isWinContextReady and latch on the person id
  // (same pattern as ContactsPage) so a post-settle isWinContext toggle
  // (focus revalidation, flag re-fetch) can't duplicate the event for the
  // same person; switching to a different person re-arms the latch.
  const firedForPersonRef = useRef<string | null>(null)
  useEffect(() => {
    if (
      isWinContextReady &&
      isWinContext &&
      currentlySelectedPersonId &&
      hasActivities &&
      !isError &&
      firedForPersonRef.current !== currentlySelectedPersonId
    ) {
      firedForPersonRef.current = currentlySelectedPersonId
      trackEvent(EVENTS.Contacts.OutreachTimelineViewed, {
        context: 'win',
        personId: currentlySelectedPersonId,
      })
    }
  }, [
    isWinContextReady,
    isWinContext,
    currentlySelectedPersonId,
    hasActivities,
    isError,
  ])

  if (isError || !hasActivities) {
    return (
      <div className="flex flex-col items-center gap-3">
        <Image
          src="/images/dashboard/no-search-result.svg"
          alt=""
          width={100}
          height={100}
          className="h-15 w-auto"
        />
        <p className="text-sm text-muted-foreground">Data not available.</p>
      </div>
    )
  }
  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 bg-muted rounded animate-pulse" />
        ))}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {activities.map((activity, idx) => {
        if (isOutreachActivity(activity)) {
          return <OutreachActivityRow key={idx} activity={activity} />
        }
        if (isPollActivity(activity)) {
          return <PollActivityRow key={idx} activity={activity} />
        }
        // Rendering for the new ContactInteraction*/ContactNote entry types
        // lands in task 07; until then, skip rather than crash.
        return null
      })}
      {hasNextPage ? (
        <Button
          type="button"
          onClick={() => onViewMore()}
          disabled={isFetchingNextPage}
          variant="outline"
          className="mt-2"
        >
          {isFetchingNextPage ? 'Loading...' : 'View more'}
        </Button>
      ) : null}
    </div>
  )
}

const INCOME_BUCKETS = [
  { label: 'Less than $1k', min: 0, max: 1000 },
  { label: '$1k - $15k', min: 1000, max: 15000 },
  { label: '$15k - $25k', min: 15000, max: 25000 },
  { label: '$25k - $35k', min: 25000, max: 35000 },
  { label: '$35k - $50k', min: 35000, max: 50000 },
  { label: '$50k - $75k', min: 50000, max: 75000 },
  { label: '$75k - $100k', min: 75000, max: 100000 },
  { label: '$100k - $125k', min: 100000, max: 125000 },
  { label: '$125k - $150k', min: 125000, max: 150000 },
  { label: '$150k - $175k', min: 150000, max: 175000 },
  { label: '$175k - $200k', min: 175000, max: 200000 },
  { label: '$200k - $250k', min: 200000, max: 250000 },
  { label: '$250k+', min: 250000, max: Infinity },
]

const getIncomeBucket = (income: number | null) => {
  if (!income) return null
  return (
    INCOME_BUCKETS.find(
      (bucket) => income >= bucket.min && income <= bucket.max,
    ) ?? null
  )
}

const PersonContent: React.FC<{
  person: Person
  hidePoliticalParty: boolean
  showWinActivities: boolean
}> = ({ person, hidePoliticalParty, showWinActivities }) => {
  const { on: showActivitiesAndIssues } = useFlagOn(
    'serve-contacts-activities-and-issues',
  )
  // Serve keeps its poll-interaction timeline behind its own flag (unchanged);
  // Win adds the outreach timeline for campaigns (not elected officials). The
  // Win decision (flag on, not an elected official, elected-office load
  // settled) is computed once in the provider as isWinContext; reuse it so the
  // feed and the provider's activities query never disagree. Top Issues stays
  // Serve-only.
  const showActivityFeed = showActivitiesAndIssues || showWinActivities
  const details = [person.gender, person.age ? `${person.age} years old` : null]
    .filter(isNotNil)
    .join(', ')

  return (
    <div>
      <h2 className="text-3xl font-semibold pt-4 pb-2">
        {formatPersonName(person)}
      </h2>
      <p className="text-xl font-semibold mb-6">{details}</p>
      <div className="flex flex-col gap-6">
        {showActivitiesAndIssues ? (
          <InfoSection title="Top Issues" icon={<LuFrown size={24} />}>
            <TopIssuesContent />
          </InfoSection>
        ) : null}

        <InfoSection title="Contact Information" icon={<LuContact size={24} />}>
          <Field
            label="Address"
            value={
              <>
                <p>{person.address.line1}</p>
                {person.address.line2 && <p>{person.address.line2}</p>}
                <p>
                  {person.address.city}, {person.address.state}{' '}
                  {person.address.zip}
                </p>
              </>
            }
          />
          {person.address.latitude && person.address.longitude && (
            <Map
              places={[
                {
                  lat: person.address.latitude,
                  lng: person.address.longitude,
                  title: formatPersonName(person),
                  description: [
                    person.address.line1,
                    person.address.line2,
                    person.address.city,
                    person.address.state,
                    person.address.zip,
                  ]
                    .filter(isNotNil)
                    .join(', '),
                },
              ]}
              height="200px"
            />
          )}
          <Field label="Cell Phone Number" value={person.cellPhone} />
          <Field label="Landline" value={person.landline} />
        </InfoSection>
        <InfoSection
          title="Voter Demographics"
          icon={<LuClipboardList size={24} />}
        >
          <Field label="Registered Voter" value={person.registeredVoter} />
          <Field label="Voter Status" value={person.voterStatus} />
          {!hidePoliticalParty && (
            <Field label="Political Party" value={person.politicalParty} />
          )}
        </InfoSection>

        <InfoSection
          title="Demographic Information"
          icon={<LuFolderOpen size={24} />}
        >
          <Field label="Marital Status" value={person.maritalStatus} />
          <Field
            label="Has Children Under 18"
            value={person.hasChildrenUnder18}
          />
          <Field label="Veteran Status" value={person.veteranStatus} />
          <Field label="Homeowner" value={person.homeowner} />
          <Field label="Business Owner" value={person.businessOwner} />
          <Field label="Level of Education" value={person.levelOfEducation} />
          <Field
            label="Estimated Income Range"
            value={getIncomeBucket(person.estimatedIncomeAmount)?.label ?? null}
          />
          <Field label="Language" value={person.language} />
          <Field label="Ethnicity Group" value={person.ethnicityGroup} />
        </InfoSection>

        {showActivityFeed ? (
          <InfoSection title="Activity Feed" icon={<LuSmile size={24} />}>
            <ActivitiesContent />
          </InfoSection>
        ) : null}
      </div>
    </div>
  )
}

export default function PersonOverlay(): React.JSX.Element {
  const {
    currentlySelectedPerson,
    selectPerson,
    currentlySelectedPersonId,
    isElectedOfficial,
    isWinContext,
  } = useContactsTable()
  const { person, isLoadingPerson, isErrorPerson } = currentlySelectedPerson

  const handleClose = (open: boolean) => {
    if (!open) {
      selectPerson(null)
    }
  }
  const shouldShowOverlay = !!currentlySelectedPersonId

  return (
    <Sheet open={shouldShowOverlay} onOpenChange={handleClose}>
      <SheetTitle className="sr-only" aria-describedby="Contact Information">
        <span id="contact-information-title">Contact Information</span>
      </SheetTitle>
      <SheetContent className="w-screen sm:w-[90vw] sm:max-w-xl h-full overflow-y-auto z-[1301]">
        <div className="p-6">
          {isErrorPerson ? (
            <div className="flex flex-col items-center justify-center h-full">
              <h2 className="text-2xl font-semibold mb-4">
                Error Loading Contact
              </h2>
              <p className="text-muted-foreground mb-4">
                We couldn&apos;t load this person&apos;s information. Please try
                again.
              </p>
              <button
                onClick={() => selectPerson(null)}
                className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
              >
                Close
              </button>
            </div>
          ) : isLoadingPerson ? (
            <div>
              <div className="h-10 bg-gray-200 rounded animate-pulse mb-4 w-3/4"></div>
              <div className="h-6 bg-gray-200 rounded animate-pulse mb-4 w-1/3"></div>
              <div className="flex flex-col gap-6">
                {[4, 2, 10].map((fieldCount, cardIndex) => (
                  <Card key={cardIndex}>
                    <CardHeader>
                      <div className="h-6 bg-gray-200 rounded animate-pulse w-1/3"></div>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                      {Array.from({ length: fieldCount }).map(
                        (_, fieldIndex) => (
                          <div key={fieldIndex} className="flex flex-col gap-1">
                            <div className="h-4 bg-gray-200 rounded animate-pulse w-1/4"></div>
                            <div className="h-5 bg-gray-200 rounded animate-pulse w-1/2"></div>
                          </div>
                        ),
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ) : (
            person && (
              <PersonContent
                person={person}
                hidePoliticalParty={isElectedOfficial}
                showWinActivities={isWinContext}
              />
            )
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
