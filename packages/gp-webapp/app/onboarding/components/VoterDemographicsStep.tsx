'use client'
import { useEffect, useMemo } from 'react'
import { useQuery, queryOptions } from '@tanstack/react-query'
import { UsersRound } from 'lucide-react'
import { clientRequest } from 'gpApi/typed-request'
import { reportErrorToSentry } from '@shared/sentry'
import { NumberInsight } from 'app/polls/onboarding/components/NumberInsight'
import { DataVisualizationInsight } from 'app/polls/onboarding/components/DataVisualizationInsight'
import { mapContactsStatsToCharts } from 'app/polls/onboarding/utils/mapContactsStatsToCharts'
import { LocalNewsSourcesSection } from './LocalNewsSourcesSection'
import { TopVoterIssuesSection } from './TopVoterIssuesSection'

const onboardingDistrictStatsQueryOptions = (params: {
  ballotReadyPositionId?: string
  districtId?: string
  // Key-only discriminator: when the request is param-less (server derives
  // the district from the org's position pointer), the org position UUID
  // keys the cache so a race edit — which re-points the org — produces a
  // fresh key and an immediate refetch instead of a stale cache hit.
  orgPositionId?: string
}) =>
  queryOptions({
    queryKey: ['onboarding-contacts-stats', params] as const,
    // Param-less mode is only useful when the org has a position to derive
    // a district from (manual-office campaigns don't) — stay disabled
    // otherwise rather than firing a guaranteed 400.
    enabled: Boolean(
      params.ballotReadyPositionId || params.districtId || params.orgPositionId,
    ),
    queryFn: () =>
      clientRequest('GET /v1/onboarding/contacts/stats', {
        // Prefer server-side derivation whenever the org pointer exists:
        // it survives race edits, while a provided BR position id may be
        // the stale onboarding snapshot. The id still participates in the
        // cache key above for warm-cache alignment with onboarding.
        ballotReadyPositionId: params.orgPositionId
          ? undefined
          : params.ballotReadyPositionId,
        districtId: params.districtId,
      }).then((res) => res.data),
  })

export { onboardingDistrictStatsQueryOptions }

interface VoterDemographicsStepProps {
  ballotReadyPositionId?: string
  districtId?: string
  // Enables param-less stats fetching: gp-api derives the district from
  // the org's position pointer, which (unlike the onboarding snapshot)
  // is kept current when the user edits their race.
  orgPositionId?: string
  city?: string
  state?: string
  office?: string
  showLocalNewsSources?: boolean
  headingsAsSubsections?: boolean
  // Copy overrides for non-candidate contexts (e.g. the elected-official
  // "serve" flow, which addresses constituents rather than voters). Each
  // defaults to the Win/candidate wording so existing call sites are unchanged.
  demographicsHeading?: string
  totalLabel?: string
  ageDistributionDescription?: string
  topIssuesHeading?: string
  topIssuesDescription?: string
}

const DEFAULT_DEMOGRAPHICS_HEADING = 'Voter Demographics'
const DEFAULT_TOTAL_LABEL = 'Total Voters'
const DEFAULT_AGE_DISTRIBUTION_DESCRIPTION =
  "We'll help you tailor your outreach mix to each age group — leaning into SMS and social for younger voters, and prioritizing mail and door-knocks for older ones."

export const VoterDemographicsStep = ({
  ballotReadyPositionId,
  districtId,
  orgPositionId,
  city,
  state,
  office,
  showLocalNewsSources = true,
  headingsAsSubsections = false,
  demographicsHeading = DEFAULT_DEMOGRAPHICS_HEADING,
  totalLabel = DEFAULT_TOTAL_LABEL,
  ageDistributionDescription = DEFAULT_AGE_DISTRIBUTION_DESCRIPTION,
  topIssuesHeading,
  topIssuesDescription,
}: VoterDemographicsStepProps): React.JSX.Element => {
  const query = useQuery(
    onboardingDistrictStatsQueryOptions({
      ballotReadyPositionId,
      districtId,
      orgPositionId,
    }),
  )

  useEffect(() => {
    if (!query.error) return
    reportErrorToSentry(query.error, {
      context: 'onboarding.voterDemographics.fetchStats',
      ballotReadyPositionId,
      districtId,
      // The only identifier present on the param-less (org-derived) path.
      orgPositionId,
    })
  }, [query.error, ballotReadyPositionId, districtId, orgPositionId])

  const isLoading =
    query.isPending &&
    Boolean(ballotReadyPositionId || districtId || orgPositionId)
  const error = query.error?.message

  const chartData = useMemo(
    () => mapContactsStatsToCharts(query.data),
    [query.data],
  )

  let locationLabel = ''
  if (office) {
    locationLabel = office
  } else if (city && state) {
    locationLabel = `${city}, ${state}`
  } else if (state) {
    locationLabel = state
  }

  const HeadingTag = headingsAsSubsections ? 'h3' : 'h2'
  const headingClass = headingsAsSubsections
    ? 'text-lg font-semibold text-foreground'
    : 'text-2xl font-semibold text-foreground'

  return (
    <div className="flex w-full flex-col items-stretch gap-6 text-left">
      <div className="space-y-2">
        <HeadingTag className={headingClass}>{demographicsHeading}</HeadingTag>
        {locationLabel ? (
          <p className="text-sm leading-6 text-muted-foreground">
            A snapshot of who lives, votes, and pays attention in{' '}
            <span className="font-semibold text-foreground">
              {locationLabel}
            </span>
            .
          </p>
        ) : null}
      </div>

      <NumberInsight
        title={totalLabel}
        value={chartData.totalConstituents || 0}
        icon={<UsersRound />}
        isLoading={isLoading}
        error={error}
        testID="onboarding-total-voters"
      />

      <DataVisualizationInsight
        chartType="barList"
        percentage={true}
        title="Age Distribution"
        description={ageDistributionDescription}
        data={chartData.ageDistribution}
        isLoading={isLoading}
        error={error}
      />

      <DataVisualizationInsight
        chartType="donut"
        percentage={true}
        title="Has Children Under 18"
        description="We'll help you reach households with kids using messaging that resonates with them — schools, safety, and after-school programs."
        data={chartData.presenceOfChildren}
        isLoading={isLoading}
        error={error}
      />

      <DataVisualizationInsight
        chartType="donut"
        percentage={true}
        title="Homeowner"
        description="We'll help you focus your door-knocking and direct mail on homeowners when property taxes, zoning, and services are central to your platform."
        data={chartData.homeowner}
        isLoading={isLoading}
        error={error}
      />

      <DataVisualizationInsight
        chartType="barList"
        percentage={true}
        title="Estimated Income Range"
        description="We'll help you frame your economic messaging across SMS, email, and canvassing scripts so it lands with each income segment."
        data={chartData.estimatedIncomeRange}
        isLoading={isLoading}
        error={error}
      />

      <DataVisualizationInsight
        chartType="barList"
        percentage={true}
        title="Education"
        description="We'll help you tune the depth and channel of your outreach (SMS, email, literature drops) to match how each education segment consumes information."
        data={chartData.education}
        isLoading={isLoading}
        error={error}
      />

      <TopVoterIssuesSection
        ballotReadyPositionId={ballotReadyPositionId}
        orgPositionId={orgPositionId}
        city={city}
        state={state}
        office={office}
        headingsAsSubsections={headingsAsSubsections}
        heading={topIssuesHeading}
        description={topIssuesDescription}
      />

      {showLocalNewsSources ? (
        <LocalNewsSourcesSection city={city} state={state} office={office} />
      ) : null}
    </div>
  )
}
