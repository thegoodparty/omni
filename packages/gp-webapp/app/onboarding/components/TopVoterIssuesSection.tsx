'use client'
import { useEffect, useState } from 'react'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { Card, CardContent } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { reportErrorToSentry } from '@shared/sentry'

interface TopVoterIssuesSectionProps {
  ballotReadyPositionId?: string
  orgPositionId?: string
  city?: string
  state?: string
  office?: string
  headingsAsSubsections?: boolean
  // Copy overrides for non-candidate contexts (e.g. the elected-official
  // "serve" flow, which addresses constituents rather than voters). Default to
  // the Win/candidate wording so existing call sites are unaffected.
  heading?: string
  description?: string
}

const DEFAULT_TOP_ISSUES_HEADING = 'Top issues for your voters'
const DEFAULT_TOP_ISSUES_DESCRIPTION =
  'The issues voters in your district care about most right now.'

const VOTER_ISSUES_QUERY_KEY = 'onboarding-voter-issues'
const VOTER_ISSUES_ROUTE = 'GET /v1/onboarding/voter-issues'
const SENTRY_CONTEXT_FETCH_ISSUES = 'onboarding.voterIssues.fetch'
const SKELETON_PLACEHOLDER_COUNT = 3
const COLLAPSED_ISSUES_VISIBLE = 3

// Endpoint derives district from the org cookie, so the request takes no
// params. We still key the cache by office identity so navigating back and
// changing zip/office refetches instead of returning the prior district.
// orgPositionId covers the post-onboarding case: a campaign-details race
// edit re-points the org's position, and keying on it turns that into a
// fresh key (and refetch) the moment the invalidated campaign reloads.
const voterIssuesQueryOptions = (params: {
  ballotReadyPositionId?: string
  orgPositionId?: string
  city?: string
  state?: string
  office?: string
}) =>
  queryOptions({
    queryKey: [VOTER_ISSUES_QUERY_KEY, params] as const,
    // Without either identifier the org has no resolvable district (manual
    // office entry) and the request is a guaranteed 404 — stay idle.
    enabled: Boolean(params.ballotReadyPositionId || params.orgPositionId),
    queryFn: () =>
      clientRequest(VOTER_ISSUES_ROUTE, {}).then((res) => res.data),
  })

export { voterIssuesQueryOptions }

const VoterIssuesSkeleton = (): React.JSX.Element => (
  <div className="space-y-3">
    {Array.from({ length: SKELETON_PLACEHOLDER_COUNT }).map((_, index) => (
      <div
        key={index}
        className="h-28 animate-pulse rounded-2xl bg-slate-100"
      />
    ))}
  </div>
)

export const TopVoterIssuesSection = ({
  ballotReadyPositionId,
  orgPositionId,
  city,
  state,
  office,
  headingsAsSubsections = false,
  heading = DEFAULT_TOP_ISSUES_HEADING,
  description = DEFAULT_TOP_ISSUES_DESCRIPTION,
}: TopVoterIssuesSectionProps): React.JSX.Element | null => {
  const query = useQuery(
    voterIssuesQueryOptions({
      ballotReadyPositionId,
      orgPositionId,
      city,
      state,
      office,
    }),
  )
  const [isExpanded, setIsExpanded] = useState(false)

  useEffect(() => {
    if (!query.error) return
    reportErrorToSentry(query.error, {
      context: SENTRY_CONTEXT_FETCH_ISSUES,
    })
  }, [query.error])

  const issues = query.data?.issues ?? []

  // Disabled queries stay isPending forever — without this, a campaign
  // with no identifiers would render an eternal skeleton instead of
  // nothing.
  if (!ballotReadyPositionId && !orgPositionId) {
    return null
  }
  if (!query.isPending && issues.length === 0) {
    return null
  }

  const visibleIssues = isExpanded
    ? issues
    : issues.slice(0, COLLAPSED_ISSUES_VISIBLE)
  const additionalCount = issues.length - COLLAPSED_ISSUES_VISIBLE

  const HeadingTag = headingsAsSubsections ? 'h3' : 'h2'
  const headingClass = headingsAsSubsections
    ? 'text-lg font-semibold text-foreground'
    : 'text-2xl font-semibold text-slate-950'

  return (
    <div className="space-y-4 text-left">
      <div className="space-y-1">
        <HeadingTag className={headingClass}>{heading}</HeadingTag>
        <p className="text-sm leading-6 text-slate-500">{description}</p>
      </div>

      {query.isPending ? (
        <VoterIssuesSkeleton />
      ) : (
        <Card className="rounded-2xl shadow-none">
          <CardContent className="flex flex-col gap-3 px-4 py-3">
            {visibleIssues.map((issue, index) => (
              <div key={issue.label} className="flex items-center gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
                  {index + 1}
                </span>
                <h3 className="text-base font-semibold text-foreground">
                  {issue.label}
                </h3>
              </div>
            ))}
            {additionalCount > 0 ? (
              <button
                type="button"
                onClick={() => setIsExpanded((prev) => !prev)}
                className="-mb-1 self-center text-sm font-semibold text-primary hover:underline"
              >
                {isExpanded
                  ? 'Show fewer issues'
                  : `View ${additionalCount} more ${
                      additionalCount === 1 ? 'issue' : 'issues'
                    }`}
              </button>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
