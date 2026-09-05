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
import {
  CircleAlertIcon,
  ClipboardListIcon,
} from '@styleguide/components/ui/icons'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import type { MyAssignment } from '@goodparty_org/contracts'
import AssignmentCard from './AssignmentCard'

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
  const active = assignments.filter((a) => a.status !== 'completed')
  const completed = assignments.filter((a) => a.status === 'completed')

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-8">
      <h1 className="m-0 text-xl font-semibold text-foreground">
        Your assignments
      </h1>

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
        <Card className="items-center gap-3 p-8 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-muted">
            <ClipboardListIcon className="size-6 text-muted-foreground" />
          </span>
          <p className="m-0 text-sm font-semibold text-foreground">
            No assignments yet
          </p>
          <p className="m-0 max-w-sm text-sm text-muted-foreground">
            Your campaign will assign you work here once it’s ready.
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
                Completed
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
