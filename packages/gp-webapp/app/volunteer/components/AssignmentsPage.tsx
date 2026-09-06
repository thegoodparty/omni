'use client'

import { useQuery } from '@tanstack/react-query'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  Skeleton,
} from '@styleguide'
import { CircleAlertIcon } from '@styleguide/components/ui/icons'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import type { MyAssignment } from '@goodparty_org/contracts'
import AssignmentCard, { isTerminalStatus } from './AssignmentCard'

export const volunteerAssignmentsQueryKey = (orgSlug: string | undefined) => [
  'volunteer-assignments',
  orgSlug,
]

const AssignmentsPage = (): React.JSX.Element => {
  const organization = useOrganization()
  const orgSlug = organization?.slug

  // isPending, not isLoading: while orgSlug hasn't resolved yet the query is
  // disabled, and in React Query v5 isLoading = isPending && isFetching — a
  // disabled query has isFetching false, so isLoading reads false too and the
  // page would flash the empty state instead of skeletons (ENG-11039).
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: volunteerAssignmentsQueryKey(orgSlug),
    queryFn: () =>
      clientRequest('GET /v1/outreach/assignments/mine', {}).then(
        (res) => res.data.assignments,
      ),
    enabled: !!orgSlug,
  })

  const assignments: MyAssignment[] = data ?? []
  const active = assignments.filter((a) => !isTerminalStatus(a.status))
  const completed = assignments.filter((a) => isTerminalStatus(a.status))

  // Shown once the query has resolved successfully, including at zero
  // assignments — the design always states the count under the H1, even in
  // the empty state. Still gated on the org name resolving, so we never
  // render "from ." before useOrganization() has a name.
  const showSubtext = !isPending && !isError && !!organization?.name
  const assignmentNoun = assignments.length === 1 ? 'assignment' : 'assignments'
  // Per-assignment logged-contact counts: peopleCalled (phone banking) and
  // loggedCount (door knocking) are the only progress fields this payload
  // carries, so summing them is the only "logged contacts" total available
  // without a second API call.
  const contactsLogged = assignments.reduce(
    (total, a) =>
      total +
      (a.phoneBanking?.peopleCalled ?? 0) +
      (a.doorKnocking?.loggedCount ?? 0),
    0,
  )
  const contactNoun = contactsLogged === 1 ? 'contact' : 'contacts'
  const subtext = `You have ${assignments.length} ${assignmentNoun} from ${organization?.name}.${
    contactsLogged >= 1
      ? ` You have logged ${contactsLogged} ${contactNoun}.`
      : ''
  }`

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-8">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-3xl font-semibold text-foreground">
          Your assignments
        </h1>
        {showSubtext && (
          <p className="m-0 text-sm text-muted-foreground">{subtext}</p>
        )}
      </div>

      {isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : isError ? (
        <Alert variant="destructive" icon={<CircleAlertIcon />}>
          <AlertTitle>Couldn’t load your assignments</AlertTitle>
          <AlertDescription>
            Something went wrong loading your assignments.
          </AlertDescription>
          <AlertAction>
            <Button
              variant="outline"
              size="small"
              onClick={() => void refetch()}
            >
              Try again
            </Button>
          </AlertAction>
        </Alert>
      ) : assignments.length === 0 ? (
        <Card className="items-center p-8 text-center">
          <p className="m-0 text-sm text-muted-foreground">
            You do not have any assignments yet. Your campaign will send you a
            list or route when they are ready.
          </p>
        </Card>
      ) : (
        <>
          {active.length > 0 && (
            <div className="flex flex-col gap-3">
              {active.map((assignment) => (
                <AssignmentCard
                  key={assignment.outreachId}
                  assignment={assignment}
                />
              ))}
            </div>
          )}
          {completed.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="m-0 text-sm font-semibold text-muted-foreground">
                Closed
              </h2>
              {completed.map((assignment) => (
                <AssignmentCard
                  key={assignment.outreachId}
                  assignment={assignment}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default AssignmentsPage
