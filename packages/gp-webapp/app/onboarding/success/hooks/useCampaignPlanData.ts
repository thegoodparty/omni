'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useUser } from '@shared/hooks/useUser'
import type { User } from 'helpers/types'
import { resolveVoterContactGoal } from '../../components/budget'
import { localNewsQueryOptions } from '../../components/LocalNewsSourcesSection'
import { voterIssuesQueryOptions } from '../../components/TopVoterIssuesSection'
import {
  buildPlanData,
  type ApiPressOutlet,
  type PlanData,
  type PlanInput,
} from '../components/planContent'
import type {
  EventsState,
  PressOutletsState,
  StrategyState,
  VoterInsightsContext,
} from '../components/PlanSections'
import { useCommunityEvents } from './useCommunityEvents'
import { useStrategicLandscape } from './useStrategicLandscape'

// Lifecycle signals per async plan resource, shaped for analytics.
// `isGenerating` is true only while the server reports an active background
// generation — a plain cache fetch never flips it, which is what lets
// consumers distinguish "user waited for a generation" from "instant fetch".
export interface PlanResourceStatus {
  ready: boolean
  isGenerating: boolean
}

export interface CampaignPlanData {
  campaignId: number | undefined
  plan: PlanData
  planReady: boolean
  state: string
  strategyState: StrategyState
  eventsState: EventsState
  pressOutletsState: PressOutletsState
  voterInsightsContext: VoterInsightsContext
  strategy: PlanResourceStatus
  communityEvents: PlanResourceStatus & { eventCount: number }
  media: PlanResourceStatus & { outletCount: number }
}

// All the data fetching and derivation behind the campaign plan, shared by
// the onboarding success page and the dashboard revisit page. Keeping it in
// one hook means the cache-key-alignment logic below stays in lockstep for
// both entry points.
export const useCampaignPlanData = (
  initialUser: User | null,
): CampaignPlanData => {
  const [clientUser] = useUser()
  const user = clientUser ?? initialUser
  const [campaign] = useCampaign()
  const campaignId = campaign?.id

  const candidateName = [user?.firstName, user?.lastName]
    .filter(Boolean)
    .join(' ')
    .trim()
  const metrics = campaign?.raceTargetMetrics
  // Prefer election-api's officialOfficeName when present — it matches the
  // BR canonical office name and is what voters will see on the ballot.
  const race =
    metrics?.officialOfficeName ||
    campaign?.positionName ||
    campaign?.organization?.customPositionName ||
    campaign?.office ||
    ''
  const stateValue = campaign?.details?.state ?? campaign?.state ?? ''
  const city = campaign?.details?.city ?? campaign?.city ?? ''
  const district = campaign?.details?.district ?? ''
  const partisanType = campaign?.details?.partisanType ?? ''
  // Stage-anchored election date from the race lookup; falls back to the
  // user-entered onboarding date when the race hash didn't resolve.
  const electionDateIso =
    metrics?.relevantElectionDate ??
    metrics?.generalElectionDate ??
    campaign?.details?.electionDate ??
    campaign?.electionDate ??
    null
  const filingDateStartIso = campaign?.details?.filingPeriodsStart ?? null
  const filingDateEndIso = campaign?.details?.filingPeriodsEnd ?? null
  const runningAgainstRef = campaign?.details?.runningAgainst
  const customIssuesRef = campaign?.details?.customIssues
  const stancesRef = campaign?.Stances
  const hubspotIncumbent =
    campaign?.data?.hubSpotUpdates?.incumbent?.trim() || null
  const winNumber = metrics?.winNumber ?? 0
  const projectedTurnout = metrics?.projectedTurnout ?? 0
  const voterContactGoal = resolveVoterContactGoal(
    metrics?.voterContactGoal,
    winNumber,
  )
  const filingFee = metrics?.filingFee ?? null
  const filingRequirementsText = metrics?.filingRequirementsText ?? null
  const registeredVoters = metrics?.registeredVoters ?? null
  const uniqueCellphones = metrics?.uniqueCellphones ?? null
  const uniqueLandlines = metrics?.uniqueLandlines ?? null
  const raceCandidatesRef = metrics?.candidates
  const milestonesRef = metrics?.milestones ?? null
  // 30-90s first generation, instant on cache hit. Hook returns
  // { data | undefined, isGenerating, isPending, isError } — PlanSections
  // decides skeleton vs hidden based on those flags.
  const strategy = useStrategicLandscape()
  // Section 7 community events — same polling shape as strategy. Pre-warm
  // fires after office submit in onboarding, so the cache is usually warm
  // by the time the user lands here.
  const events = useCommunityEvents()
  // The BR position ID is in-memory on `answers.structuredOffice.positionId`
  // during onboarding. After pledge submit, `OnboardingFlow` persists the
  // whole `answers` object under `campaign.data.onboarding`, so it survives
  // the navigation to /onboarding/success.
  //
  // gp-api separately resolves the BR ID to an internal Position UUID and
  // stores that on `organization.positionId` — which is NOT what the
  // /onboarding/contacts/stats endpoint expects, so we read directly from
  // the persisted onboarding answers instead.
  //
  // We also pull positionName / city / state from the same source for the
  // local-news query below so the cache key matches what
  // LocalNewsSourcesSection used during onboarding — see comment there.
  const onboardingStructuredOffice = (
    campaign?.data as
      | {
          onboarding?: {
            structuredOffice?: {
              positionId?: string
              positionName?: string
              city?: string
              state?: string
            }
          }
        }
      | undefined
  )?.onboarding?.structuredOffice
  const ballotReadyPositionId = onboardingStructuredOffice?.positionId

  // Cache-key alignment with onboarding: any query that was warmed by
  // onboarding must use the SAME (office, city, state) tuple onboarding
  // sent, otherwise React Query cold-misses and gp-api re-runs the
  // upstream call. Two consumers below depend on this:
  //
  //   1. local-news query (Section 7 press outlets) — onboarding's
  //      `LocalNewsSourcesSection` populated both React Query and
  //      `campaign.data.onboarding.localMediaOutlets` using
  //      `answers.structuredOffice.{positionName, city, state}`.
  //   2. voter-issues query + `voterInsightsContext` (Section 3 + 4) —
  //      onboarding's `TopVoterIssuesSection` populated React Query
  //      with the same triple.
  //
  // The success page's polished `race` is election-api's
  // `officialOfficeName` (e.g. "Anytown Council"), which differs from
  // BR's `positionName` ("City Council Member") that onboarding used.
  // Reading from `race` here would miss both warm caches. Pull from
  // `onboardingStructuredOffice` first, fall back to the existing
  // chain for manual-office-entry candidates who never populated it.
  //
  // The endpoints' Zod schemas reject empty-string fields (min 1
  // char). Pass `undefined` for empty values so the request shape
  // omits the field — serializing `city: ''` would hit the validator
  // and 400.
  const onboardingOffice = onboardingStructuredOffice?.positionName || race
  const onboardingCity = onboardingStructuredOffice?.city || city
  const onboardingState = onboardingStructuredOffice?.state || stateValue
  const localNewsQuery = useQuery(
    localNewsQueryOptions({
      city: onboardingCity || undefined,
      state: onboardingState || undefined,
      office: onboardingOffice || undefined,
    }),
  )
  const pressOutletsFromApi: ApiPressOutlet[] | undefined =
    localNewsQuery.data?.status === 'ready'
      ? localNewsQuery.data.outlets
      : undefined
  // Mirror the events/strategy hooks: while the local-news endpoint is
  // initialising or actively polling on a `pending` status, surface that
  // as "generating" so PlanSections shows the skeleton instead of an empty
  // table or stale templated rows.
  const isLocalNewsGenerating =
    localNewsQuery.isPending || localNewsQuery.data?.status === 'pending'

  // Same cache key as TopVoterIssuesSection in onboarding — keeps the PDF's
  // Section 3 in sync with what the user already saw on screen. See the
  // onboardingOffice/City/State derivation above for why we don't use
  // `race`/`city`/`stateValue` directly.
  const voterIssuesQuery = useQuery(
    voterIssuesQueryOptions({
      ballotReadyPositionId,
      city: onboardingCity,
      state: onboardingState,
      office: onboardingOffice,
    }),
  )
  const voterIssuesFromApi = voterIssuesQuery.data?.issues

  const plan = useMemo(() => {
    const input: PlanInput = {
      candidateName,
      race,
      district,
      city,
      state: stateValue,
      partisanType,
      electionDateIso,
      filingDateStartIso,
      filingDateEndIso,
      winNumber,
      projectedTurnout,
      voterContactGoal,
      runningAgainst: runningAgainstRef ?? [],
      customIssues: customIssuesRef ?? [],
      stances: (stancesRef ?? []).map((s) => ({
        issueName: s.Issue?.name,
        statement: s.stanceStatement,
      })),
      hubspotIncumbent,
      filingFee,
      filingRequirementsText,
      registeredVoters,
      uniqueCellphones,
      uniqueLandlines,
      raceCandidates: raceCandidatesRef ?? [],
      milestones: milestonesRef,
      strategicLandscape: strategy.data,
      communityEvents: events.data,
      pressOutletsFromApi,
      voterIssuesFromApi,
    }
    return buildPlanData(input)
  }, [
    candidateName,
    race,
    district,
    city,
    stateValue,
    partisanType,
    electionDateIso,
    filingDateStartIso,
    filingDateEndIso,
    winNumber,
    projectedTurnout,
    voterContactGoal,
    runningAgainstRef,
    customIssuesRef,
    stancesRef,
    hubspotIncumbent,
    filingFee,
    filingRequirementsText,
    registeredVoters,
    uniqueCellphones,
    uniqueLandlines,
    raceCandidatesRef,
    milestonesRef,
    strategy.data,
    events.data,
    pressOutletsFromApi,
    voterIssuesFromApi,
  ])

  // Gate the download until every async source the PDF depends on has
  // settled. "Settled" means finished — data arrived OR the request errored.
  // An errored source still counts as ready: its `isGenerating`/`isPending`
  // flag flips to false, and the PDF carries the same empty-state copy the
  // page shows. The polling sources expose both flags; voter issues is a
  // one-shot fetch, so `isPending` alone covers it.
  const planReady =
    !(strategy.isPending || strategy.isGenerating) &&
    !(events.isPending || events.isGenerating) &&
    !isLocalNewsGenerating &&
    !voterIssuesQuery.isPending

  return {
    campaignId,
    plan,
    planReady,
    state: stateValue,
    strategyState: {
      isGenerating: strategy.isPending || strategy.isGenerating,
      isError: strategy.isError,
    },
    eventsState: {
      isGenerating: events.isPending || events.isGenerating,
      isError: events.isError,
    },
    pressOutletsState: {
      isGenerating: isLocalNewsGenerating,
      isError: localNewsQuery.isError,
    },
    voterInsightsContext: {
      ballotReadyPositionId,
      city: onboardingCity,
      state: onboardingState,
      office: onboardingOffice,
    },
    strategy: {
      ready: strategy.data !== undefined,
      isGenerating: strategy.isGenerating,
    },
    communityEvents: {
      ready: events.data !== undefined,
      isGenerating: events.isGenerating,
      eventCount: events.data?.events?.length ?? 0,
    },
    media: {
      ready: localNewsQuery.data?.status === 'ready',
      // Deliberately excludes the initial fetch (`isPending`) — only a
      // server-reported `pending` status counts as generating.
      isGenerating: localNewsQuery.data?.status === 'pending',
      outletCount: pressOutletsFromApi?.length ?? 0,
    },
  }
}
