'use client'

import { Button, Card, CardContent } from '@styleguide'
import { CalendarCheck, Target, UsersRound, Wand2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  createCampaignWithOffice,
  onboardingStep,
  updateCampaign,
} from 'app/onboarding/shared/ajaxActions'

const ONBOARDING_STEP_COMPLETE = 'onboarding-complete'
import { useCampaign } from '@shared/hooks/useCampaign'
import { CAMPAIGN_QUERY_KEY } from '@shared/hooks/CampaignProvider'
import { useUser } from '@shared/hooks/useUser'
import { clientRequest } from 'gpApi/typed-request'
import { clientFetch } from 'gpApi/clientFetch'
import { apiRoutes } from 'gpApi/routes'
import { setCookie } from 'helpers/cookieHelper'
import { ORG_SLUG_COOKIE } from '@shared/organizations/constants'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { identifyUser } from '@shared/utils/analytics'
import { reportErrorToSentry } from '@shared/sentry'
import { numberFormatter } from 'helpers/numberHelper'
import type { Campaign } from 'helpers/types'
import { prewarmCommunityEvents } from '../success/hooks/useCommunityEvents'
import { prewarmStrategicLandscape } from '../success/hooks/useStrategicLandscape'
import { useCampaignStrategyFlag } from '@shared/experiments/campaignStrategyFlag'
import { useCampaignStoryFlag } from '@shared/experiments/campaignStoryFlag'
import { ONBOARDING_STEPS, firstOnboardingStepId } from './onboardingConfig'
import {
  getVisibleOnboardingSteps,
  resolvePostPledgeRoute,
} from './onboardingHelpers'
import { OfficeSelectionStep } from './OfficeSelectionStep'
import { ManualOfficeEntryStep } from './ManualOfficeEntryStep'
import { PathToVictoryStep } from './PathToVictoryStep'
import { PledgeStep } from './PledgeStep'
import OnboardingTopBar from '../shared/OnboardingTopBar'
import { WhyThisMatters } from './WhyThisMatters'
import { localNewsQueryOptions } from './LocalNewsSourcesSection'
import OnboardingCampaignStoryStep from './OnboardingCampaignStoryStep'
import { RadioCardGroup, type RadioCardOption } from './RadioCardGroup'
import { MajorPartyBlockedAlert } from '../shared/partisanParty'
import type {
  BallotStatus,
  ManualOfficeForm,
  NonEmptyArray,
  OnboardingStepConfig,
  OnboardingAnswers,
  OnboardingStepId,
  PartyAffiliation,
  SelectedOffice,
} from './onboardingTypes'

type OnboardingUpdateAttribute = {
  key: string
  value: string | number | boolean | OnboardingAnswers | null | undefined
}

const ballotStatusOptions: ReadonlyArray<RadioCardOption<BallotStatus>> = [
  {
    value: 'on-ballot',
    title: "I'm officially on the ballot",
    description: 'Filing accepted by your local elections office.',
  },
  {
    value: 'qualified-not-filed',
    title: "I've qualified but haven't filed",
    description: 'You meet residency/age/petition requirements.',
  },
  {
    value: 'considering',
    title: "I'm seriously considering running",
    description: "We'll help you understand what it takes.",
  },
  {
    value: 'testing',
    title: "I'm just testing out the product",
    description: 'Poke around with sample data — no commitment required.',
  },
]

const partyAffiliationOptions: ReadonlyArray<
  RadioCardOption<PartyAffiliation>
> = [
  {
    value: 'nonpartisan',
    title: 'Nonpartisan Race',
    description:
      'The race itself is officially nonpartisan (most local seats).',
  },
  {
    value: 'independent-or-non-major',
    title: 'Independent / Non-major party',
    description: 'Running independent of both major parties.',
  },
  {
    value: 'democrat',
    title: 'Democrat',
    description: 'Running as a Democrat.',
  },
  {
    value: 'republican',
    title: 'Republican',
    description: 'Running as a Republican.',
  },
]

const isMajorPartyAffiliation = (
  value: PartyAffiliation | undefined,
): boolean => value === 'democrat' || value === 'republican'

const partyAffiliationToCampaignParty: Record<PartyAffiliation, string> = {
  nonpartisan: 'nonpartisan',
  'independent-or-non-major': 'independent',
  democrat: 'democrat',
  republican: 'republican',
}

const ballotStatusToCandidateStage: Record<
  BallotStatus,
  'FILED' | 'QUALIFIED' | 'CONSIDERING' | 'TESTING'
> = {
  'on-ballot': 'FILED',
  'qualified-not-filed': 'QUALIFIED',
  considering: 'CONSIDERING',
  testing: 'TESTING',
}

const PLEDGE_VERSION = 1

interface PartyAffiliationStepProps {
  value: PartyAffiliation | undefined
  onChange: (value: PartyAffiliation) => void
}

const PartyAffiliationStep = ({
  value,
  onChange,
}: PartyAffiliationStepProps): React.JSX.Element => {
  return (
    <div className="space-y-4">
      {isMajorPartyAffiliation(value) ? <MajorPartyBlockedAlert /> : null}
      <RadioCardGroup
        name="party-affiliation"
        value={value}
        onChange={onChange}
        options={partyAffiliationOptions}
      />
    </div>
  )
}

const welcomeCards = [
  {
    title: 'Know how many votes you need to win',
    description:
      "We use real voter data and historical local turnout to project the number of votes you'll need to win.",
    Icon: Target,
  },
  {
    title: 'Learn what issues matter to your voters',
    description:
      'We analyze your local voter data to surface and rank their top issues and concerns.',
    Icon: UsersRound,
  },
  {
    title: 'Get a powerful outreach plan & materials',
    description:
      'We create personalized stump speeches, door-knocking scripts, fundraising emails, social posts, all drafted from your profile and platform.',
    Icon: Wand2,
  },
  {
    title: 'Plan with a budget and calendar of tasks',
    description:
      'We provide you with a minimum resources budget and an interactive weekly plan of tasks & actions that give you the best chances of winning.',
    Icon: CalendarCheck,
  },
]

interface StepBodyProps {
  activeStep: OnboardingStepConfig
  answers: OnboardingAnswers
  updateAnswers: (answers: Partial<OnboardingAnswers>) => void
  onCantFindOffice: () => void
  onOfficeHydratingChange: (isHydrating: boolean) => void
  liveCampaign: Campaign | null
  onP2vLoadingChange: (loading: boolean) => void
  onP2vMetricsResolved: NonNullable<
    React.ComponentProps<typeof PathToVictoryStep>['onMetricsResolved']
  >
  p2vOfficeName: string | null
  skipP2vReveal: boolean
  onStoryCompleteChange: (complete: boolean) => void
}

const StepBody = ({
  activeStep,
  answers,
  updateAnswers,
  onCantFindOffice,
  onOfficeHydratingChange,
  liveCampaign,
  onP2vLoadingChange,
  onP2vMetricsResolved,
  p2vOfficeName,
  skipP2vReveal,
  onStoryCompleteChange,
}: StepBodyProps): React.JSX.Element | null => {
  if (activeStep.id === 'welcome') {
    return (
      <div className="space-y-8">
        <div className="grid gap-4 sm:grid-cols-2">
          {welcomeCards.map(({ title, description, Icon }) => (
            <Card
              key={title}
              className="rounded-xl border-base-border text-left shadow-none"
            >
              <CardContent className="space-y-4">
                <span className="flex size-10 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <div className="space-y-2">
                  <h2 className="text-base font-semibold text-foreground">
                    {title}
                  </h2>
                  <p className="text-sm text-muted-foreground">{description}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="text-center text-sm text-muted-foreground">
          Ready? Hit{' '}
          <span className="font-semibold text-foreground">Continue</span> to get
          started.
        </p>
      </div>
    )
  }

  if (activeStep.id === 'ballot-status') {
    return (
      <RadioCardGroup
        name="ballot-status"
        value={answers.ballotStatus}
        onChange={(value) => updateAnswers({ ballotStatus: value })}
        options={ballotStatusOptions}
      />
    )
  }

  if (activeStep.id === 'party-affiliation') {
    return (
      <PartyAffiliationStep
        value={answers.partyAffiliation}
        onChange={(value) => updateAnswers({ partyAffiliation: value })}
      />
    )
  }

  if (activeStep.id === 'office-selection') {
    return (
      <OfficeSelectionStep
        zip={answers.officeZip}
        selected={answers.structuredOffice}
        onZipChange={(zip) => updateAnswers({ officeZip: zip })}
        onSelect={(office) =>
          updateAnswers({
            structuredOffice: office,
            officePath: office ? 'structured' : undefined,
            manualOffice: office ? false : undefined,
            unmatchedOffice: office ? false : undefined,
          })
        }
        onCantFindOffice={onCantFindOffice}
        onHydratingChange={onOfficeHydratingChange}
      />
    )
  }

  if (activeStep.id === 'manual-office-entry') {
    return (
      <ManualOfficeEntryStep
        value={answers.manualOfficeForm}
        onChange={(form) => updateAnswers({ manualOfficeForm: form })}
      />
    )
  }

  if (activeStep.id === 'path-to-victory') {
    return (
      <PathToVictoryStep
        campaign={liveCampaign}
        officeName={p2vOfficeName}
        onLoadingChange={onP2vLoadingChange}
        onMetricsResolved={onP2vMetricsResolved}
        skipReveal={skipP2vReveal}
      />
    )
  }

  if (activeStep.id === 'campaign-story') {
    return (
      <OnboardingCampaignStoryStep onCompleteChange={onStoryCompleteChange} />
    )
  }

  if (activeStep.id === 'pledge') {
    return <PledgeStep />
  }

  return null
}

export default function OnboardingFlow({
  campaign: initialCampaign = null,
}: {
  campaign?: Campaign | null
} = {}): React.JSX.Element {
  const router = useRouter()
  const [contextCampaign] = useCampaign()
  const campaign = contextCampaign ?? initialCampaign
  const [user] = useUser()
  // Gates the post-pledge Campaign Plan flow. When off, we skip the LLM
  // pre-warm calls and route the candidate directly to /dashboard after
  // pledge instead of /onboarding/success.
  const { ready: campaignStrategyReady, enabled: campaignStrategyEnabled } =
    useCampaignStrategyFlag()
  // Campaign-story users don't auto-generate a plan during onboarding: they
  // write their Campaign Story first, then generate from it. So we skip the
  // pre-warm and route them to the story page instead of /onboarding/success.
  // trackExposure=false: onboarding only reads the flag for routing, it's not
  // the treatment surface (the story page is), so the read mustn't fire
  // exposure for every onboarding visitor.
  const { ready: campaignStoryReady, enabled: campaignStoryEnabled } =
    useCampaignStoryFlag(false)
  // The campaign-story step lives in the static config but only for the story
  // cohort. Inject it (flag-gated) into the array getVisibleOnboardingSteps
  // filters, so the stepper count and back/forward navigation stay correct.
  const [welcomeStep, ...laterOnboardingSteps] = ONBOARDING_STEPS
  const effectiveSteps: NonEmptyArray<OnboardingStepConfig> =
    campaignStoryEnabled
      ? ONBOARDING_STEPS
      : [
          welcomeStep,
          ...laterOnboardingSteps.filter(
            (step) => step.id !== 'campaign-story',
          ),
        ]
  // Only hydrate from campaign if explicitly resuming (not on first onboarding visit)
  // If the router has ?resume=1 or similar, you could use that; for now, always start fresh
  const [answers, setAnswers] = useState<OnboardingAnswers>({})
  const [activeStepId, setActiveStepId] = useState<OnboardingStepId>(
    firstOnboardingStepId,
  )
  const [isSavingOffice, setIsSavingOffice] = useState(false)
  const [isHydratingOffice, setIsHydratingOffice] = useState(false)
  // Reported by OnboardingCampaignStoryStep as its underlying cards resolve.
  // Gates the campaign-story step's footer label and whether continuing
  // fires plan generation.
  const [storyComplete, setStoryComplete] = useState(false)
  const isAdvancingRef = useRef(false)
  const partyDesignationBlockedFiredRef = useRef(false)
  // Guards against a double-fire of the strategic-landscape pre-warm (e.g. a
  // rapid double-click of Continue). Generation - and the Completed event
  // that rides with it - fires at most once ever, on first completion.
  const storyGenFiredRef = useRef(false)
  // Guards CampaignStorySkipped so a user who skips, goes Back, and skips
  // again only counts once. Independent of storyGenFiredRef: a Skipped fire
  // must not block a later Completed fire (skip-then-complete still upgrades
  // to Completed + generation).
  const storySkippedFiredRef = useRef(false)
  const [liveCampaign, setLiveCampaign] = useState<Campaign | null>(
    initialCampaign,
  )
  const [isP2vLoading, setIsP2vLoading] = useState(true)
  const [resolvedP2vOfficeKey, setResolvedP2vOfficeKey] = useState<
    string | null
  >(null)
  const queryClient = useQueryClient()

  // Tracking the resolved office (rather than a boolean) lets the
  // path-to-victory effect re-run when the user goes back and changes
  // zip/office, so the new race's metrics replace the previous one.
  // `||` (not `??`) so an empty-string id falls through to the next option
  // instead of being treated as a valid identity.
  const officeIdentityKey =
    answers.structuredOffice?.positionId ||
    answers.structuredOffice?.raceId ||
    (answers.manualOfficeForm
      ? `manual:${answers.manualOfficeForm.state}:${answers.manualOfficeForm.city}:${answers.manualOfficeForm.office}`
      : null)
  const hasResolvedPathToVictory =
    Boolean(officeIdentityKey) && resolvedP2vOfficeKey === officeIdentityKey

  const visibleSteps = getVisibleOnboardingSteps(effectiveSteps, answers)
  const activeIndex = Math.max(
    0,
    visibleSteps.findIndex((step) => step.id === activeStepId),
  )
  const activeStep = visibleSteps[activeIndex] ?? visibleSteps[0]
  const previousStep = activeIndex > 0 ? visibleSteps[activeIndex - 1] : null
  const nextStep = visibleSteps[activeIndex + 1] ?? null
  const activeStepNumber = activeIndex + 1
  const isActiveStepValid = activeStep.isValid?.({ answers }) ?? true
  const isP2vBlocking = activeStep.id === 'path-to-victory' && isP2vLoading
  const isOfficeHydrationBlocking =
    activeStep.id === 'office-selection' && isHydratingOffice
  const p2vOfficeName =
    answers.structuredOffice?.positionName ||
    liveCampaign?.positionName ||
    liveCampaign?.organization?.customPositionName ||
    liveCampaign?.office ||
    null
  // Block the pledge step's Continue until both plan flags resolve — routing
  // post-pledge depends on them, and reading them mid-init would default to
  // false and misroute (e.g. a campaign-story user sent to /onboarding/success
  // and into the pre-warm they're excluded from).
  const pledgeFlagsReady =
    activeStep.id !== 'pledge' || (campaignStrategyReady && campaignStoryReady)
  const canContinue =
    isActiveStepValid &&
    !isSavingOffice &&
    !isP2vBlocking &&
    !isOfficeHydrationBlocking &&
    // Hold Continue until the story flag resolves so effectiveSteps is stable
    // (story step present) before the candidate can advance past it. Otherwise
    // a slow flag load drops the step and they never see it.
    campaignStoryReady &&
    pledgeFlagsReady

  const handleP2vLoadingChange = useCallback((loading: boolean) => {
    setIsP2vLoading(loading)
  }, [])

  const handleP2vMetricsResolved = useCallback<
    NonNullable<
      React.ComponentProps<typeof PathToVictoryStep>['onMetricsResolved']
    >
  >(
    (result) => {
      const campaignId = liveCampaign?.id ?? campaign?.id
      if (result.status === 'success') {
        if (officeIdentityKey) {
          setResolvedP2vOfficeKey(officeIdentityKey)
        }
        trackEvent(EVENTS.OnboardingV2.VotesNeededCalculated, {
          campaignId,
          projectedTurnout: result.projectedTurnout,
          winNumber: result.winNumber,
          voterContactGoal: liveCampaign?.raceTargetMetrics?.voterContactGoal,
          totalRegisteredVoters: result.totalRegisteredVoters,
          source: 'ballot_ready',
          modelVersion: 1,
        })
        if (user?.id) {
          void identifyUser(user.id, { hasWinNumber: true })
        }
      } else {
        trackEvent(EVENTS.OnboardingV2.VotesNeededFailed, {
          campaignId,
          reason: result.reason,
        })
      }
    },
    [liveCampaign, campaign, user?.id, officeIdentityKey],
  )

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [activeStepId])

  // V2 step-funnel `Viewed` events: fire once per step, the first time it is
  // entered. The seen-set ref dedupes so neither a re-render nor back-and-forth
  // navigation re-fires. manual-office-entry has no V2 event.
  const viewedStepsFiredRef = useRef<Set<OnboardingStepId>>(new Set())
  useEffect(() => {
    // Wait for the user, then attach email directly. SegmentIdentify sets the
    // shared email global, but it mounts after the page content (PageWrapper),
    // so an on-mount event races ahead of it and would otherwise be email-less.
    if (!user) return
    const viewedEventByStep: Partial<Record<OnboardingStepId, string>> = {
      welcome: EVENTS.OnboardingV2.WelcomeViewed,
      'ballot-status': EVENTS.OnboardingV2.BallotStatusViewed,
      'party-affiliation': EVENTS.OnboardingV2.PartyDesignationViewed,
      'office-selection': EVENTS.OnboardingV2.OfficeViewed,
      'path-to-victory': EVENTS.OnboardingV2.VotesNeededViewed,
      'campaign-story': EVENTS.OnboardingV2.CampaignStoryViewed,
      pledge: EVENTS.OnboardingV2.PledgeViewed,
    }
    const viewedEvent = viewedEventByStep[activeStepId]
    if (viewedEvent && !viewedStepsFiredRef.current.has(activeStepId)) {
      viewedStepsFiredRef.current.add(activeStepId)
      trackEvent(viewedEvent, {
        campaignId: campaign?.id,
        email: user.email,
      })
    }
    // campaign?.id intentionally omitted from deps: the seen-set guards the
    // single fire, and the id resolving mid-step must not re-trigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStepId, user])

  useEffect(() => {
    if (activeStepId !== 'office-selection') setIsHydratingOffice(false)
  }, [activeStepId])

  const handleOfficeHydratingChange = useCallback((hydrating: boolean) => {
    setIsHydratingOffice(hydrating)
  }, [])

  useEffect(() => {
    if (activeStepId !== 'path-to-victory') return
    if (hasResolvedPathToVictory) return
    let cancelled = false
    setIsP2vLoading(true)
    void (async () => {
      try {
        const res = await clientRequest('GET /v1/campaigns/mine', {})
        if (!cancelled && res.data) {
          setLiveCampaign(res.data)
        }
      } catch (error) {
        if (!cancelled) {
          reportErrorToSentry(error, {
            context: 'onboarding.fetchLiveCampaign',
            activeStepId,
          })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeStepId, hasResolvedPathToVictory])

  useEffect(() => {
    if (activeStepId !== 'path-to-victory') return
    const city = answers.structuredOffice?.city
    const state = answers.structuredOffice?.state
    const office = answers.structuredOffice?.positionName
    if (state && office) {
      void queryClient.prefetchQuery(
        localNewsQueryOptions({ city, state, office }),
      )
    }
  }, [
    activeStepId,
    answers.structuredOffice?.city,
    answers.structuredOffice?.state,
    answers.structuredOffice?.positionName,
    queryClient,
  ])

  // V2 disqualification event: selecting a major party shows the blocking
  // alert (there is no Continue). Dedupe to once per session via a ref so
  // toggling between Democrat and Republican does not spam the event.
  useEffect(() => {
    if (
      isMajorPartyAffiliation(answers.partyAffiliation) &&
      !partyDesignationBlockedFiredRef.current
    ) {
      partyDesignationBlockedFiredRef.current = true
      trackEvent(EVENTS.OnboardingV2.PartyDesignationBlocked, {
        campaignId: campaign?.id,
        partyAffiliation: answers.partyAffiliation,
      })
    }
  }, [answers.partyAffiliation, campaign?.id])

  const updateAnswers = (answerPatch: Partial<OnboardingAnswers>) => {
    setAnswers((currentAnswers) => ({ ...currentAnswers, ...answerPatch }))
  }

  const goBack = () => {
    if (previousStep) {
      setActiveStepId(previousStep.id)
    }
  }

  const buildEarlyAnswerAttrs = (): OnboardingUpdateAttribute[] => {
    const attrs: OnboardingUpdateAttribute[] = []
    if (answers.partyAffiliation) {
      attrs.push({
        key: 'details.party',
        value: partyAffiliationToCampaignParty[answers.partyAffiliation],
      })
    }
    if (answers.ballotStatus) {
      attrs.push({ key: 'details.ballotStatus', value: answers.ballotStatus })
    }
    return attrs
  }

  const persistStructuredOffice = async (
    office: SelectedOffice,
  ): Promise<boolean> => {
    const attr = [
      { key: 'details.electionId', value: office.electionId },
      { key: 'details.raceId', value: office.raceId },
      { key: 'details.state', value: office.state },
      { key: 'details.city', value: office.city },
      { key: 'details.district', value: '' },
      { key: 'details.officeTermLength', value: office.officeTermLength },
      { key: 'details.ballotLevel', value: office.level },
      {
        key: 'details.primaryElectionDate',
        value: office.primaryElectionDate,
      },
      { key: 'details.electionDate', value: office.electionDay },
      { key: 'details.partisanType', value: office.partisanType },
      { key: 'details.primaryElectionId', value: office.primaryElectionId },
      { key: 'details.hasPrimary', value: office.hasPrimary },
      { key: 'details.filingPeriodsStart', value: office.filingPeriodsStart },
      { key: 'details.filingPeriodsEnd', value: office.filingPeriodsEnd },
      // Persist the office-picker ZIP onto the campaign so HubSpot's Company
      // sync sends it (candidate_zip) and Peerly line rental can derive the
      // DID area code — without it, new candidates end up with no area code
      // and can't rent a robocall number (ENG-10618).
      ...(answers.officeZip
        ? [{ key: 'details.zip', value: answers.officeZip }]
        : []),
    ]

    const trackingProperties = {
      officeState: office.state,
      officeMunicipality: office.city ?? 'Unavailable',
      officeName: office.positionName,
      officeElectionDate: office.electionDay,
    }

    const resolvedOrgSlug = campaign ? `campaign-${campaign.id}` : undefined

    if (resolvedOrgSlug && office.positionId) {
      try {
        await clientRequest('PATCH /v1/organizations/:slug', {
          slug: resolvedOrgSlug,
          ballotReadyPositionId: office.positionId,
          customPositionName: null,
        })
      } catch (error) {
        reportErrorToSentry(error, {
          context: 'onboarding.persistStructuredOffice.patchOrganization',
          campaignId: liveCampaign?.id ?? campaign?.id,
        })
        return false
      }
    }

    if (campaign) {
      const updated = await updateCampaign(attr)
      if (updated === false) return false
      await identifyUser(user?.id, {
        ...trackingProperties,
        officeType: office.level,
      })
      trackEvent(EVENTS.OnboardingV2.OfficeCompleted, {
        campaignId: campaign.id,
        officeName: office.positionName,
        officeLevel: office.level,
        officeState: office.state,
        electionDate: office.electionDay,
      })
      return true
    }

    const createAttr = [
      ...attr,
      ...buildEarlyAnswerAttrs(),
      {
        key: 'data.currentStep',
        value: nextStep?.id ?? onboardingStep(undefined, 1),
      },
      { key: 'data.onboarding', value: answers },
      { key: 'ballotReadyPositionId', value: office.positionId },
    ]
    const newCampaign = await createCampaignWithOffice(createAttr)
    if (!newCampaign) return false
    setCookie(ORG_SLUG_COOKIE, `campaign-${newCampaign.id}`)
    setLiveCampaign(newCampaign)
    // CampaignProvider cached the prior 404 (no campaign yet) for this
    // session. POST /campaigns returns the bare campaign without
    // raceTargetMetrics — those are only computed by GET /campaigns/mine —
    // so we invalidate instead of seeding the cache, forcing the next read
    // to refetch the fully-hydrated record.
    void queryClient.invalidateQueries({ queryKey: CAMPAIGN_QUERY_KEY })
    await identifyUser(user?.id, {
      ...trackingProperties,
      officeType: office.level,
    })
    trackEvent(EVENTS.OnboardingV2.OfficeCompleted, {
      campaignId: newCampaign.id,
      officeName: office.positionName,
      officeLevel: office.level,
      officeState: office.state,
      electionDate: office.electionDay,
    })
    return true
  }

  const persistManualOffice = async (
    form: ManualOfficeForm,
  ): Promise<boolean> => {
    const baseAttr = [
      { key: 'details.raceId', value: null },
      { key: 'details.electionId', value: null },
      { key: 'details.ballotOffice', value: null },
      { key: 'details.partisanType', value: null },
      { key: 'details.primaryElectionDate', value: '' },
      { key: 'details.primaryElectionId', value: null },
      { key: 'details.hasPrimary', value: null },
      { key: 'details.filingPeriodsStart', value: null },
      { key: 'details.filingPeriodsEnd', value: null },
      { key: 'details.state', value: form.state },
      { key: 'details.city', value: form.city },
      { key: 'details.district', value: form.district },
      { key: 'details.officeTermLength', value: form.officeTermLength },
      { key: 'details.electionDate', value: form.electionDate },
      // Manual entry doesn't collect ZIP directly — the office-picker step
      // required a valid ZIP before "I don't see my office" was clickable, so
      // reuse that. Persist so HubSpot / Peerly get an area code (ENG-10618).
      ...(answers.officeZip
        ? [{ key: 'details.zip', value: answers.officeZip }]
        : []),
    ]
    const customPositionName = form.office

    const trackingProperties = {
      officeState: form.state,
      officeMunicipality: form.city,
      officeName: form.office,
      officeElectionDate: form.electionDate,
    }

    if (campaign) {
      const updated = await updateCampaign(baseAttr)
      if (updated === false) return false
      try {
        await clientRequest('PATCH /v1/organizations/:slug', {
          slug: `campaign-${campaign.id}`,
          ballotReadyPositionId: null,
          customPositionName,
        })
      } catch (error) {
        reportErrorToSentry(error, {
          context: 'onboarding.persistManualOffice.patchOrganization',
          campaignId: campaign.id,
        })
        return false
      }
      await identifyUser(user?.id, {
        ...trackingProperties,
        officeType: 'manual',
      })
      trackEvent(EVENTS.OnboardingV2.OfficeCompleted, {
        campaignId: campaign.id,
        officeName: form.office,
        officeLevel: 'manual',
        officeState: form.state,
        electionDate: form.electionDate,
      })
      return true
    }

    const createAttr = [
      ...baseAttr,
      ...buildEarlyAnswerAttrs(),
      {
        key: 'data.currentStep',
        value: nextStep?.id ?? onboardingStep(undefined, 1),
      },
      { key: 'data.onboarding', value: answers },
      { key: 'customPositionName', value: customPositionName },
    ]
    const newCampaign = await createCampaignWithOffice(createAttr)
    if (!newCampaign) return false
    setCookie(ORG_SLUG_COOKIE, `campaign-${newCampaign.id}`)
    setLiveCampaign(newCampaign)
    void queryClient.invalidateQueries({ queryKey: CAMPAIGN_QUERY_KEY })
    await identifyUser(user?.id, {
      ...trackingProperties,
      officeType: 'manual',
    })
    trackEvent(EVENTS.OnboardingV2.OfficeCompleted, {
      campaignId: newCampaign.id,
      officeName: form.office,
      officeLevel: 'manual',
      officeState: form.state,
      electionDate: form.electionDate,
    })
    return true
  }

  const persistPartyAffiliation = async (
    affiliation: PartyAffiliation,
  ): Promise<boolean> => {
    const party = partyAffiliationToCampaignParty[affiliation]
    if (campaign) {
      const updated = await updateCampaign([
        { key: 'details.party', value: party },
      ])
      if (updated === false) return false
    }
    trackEvent(EVENTS.OnboardingV2.PartyDesignationCompleted, {
      campaignId: campaign?.id,
      partyAffiliation: affiliation,
    })
    if (user?.id) {
      await identifyUser(user.id, { affiliation: party, party })
    }
    return true
  }

  const persistPledgeAndComplete = async (): Promise<boolean> => {
    const effectiveCampaignId = liveCampaign?.id ?? campaign?.id
    // Pre-flight click signal — fires before updateCampaign/launchCampaign, so
    // it can fire even if the pledge ultimately fails. Not a completion signal.
    trackEvent(EVENTS.OnboardingV2.PledgeSubmitClicked, {
      campaignId: effectiveCampaignId,
    })
    const updated = await updateCampaign([
      { key: 'details.pledged', value: true },
      { key: 'data.currentStep', value: ONBOARDING_STEP_COMPLETE },
      { key: 'data.onboarding', value: answers },
    ])
    if (updated === false) return false
    try {
      const launchResp = await clientFetch(apiRoutes.campaign.launch)
      if (!launchResp.ok) {
        reportErrorToSentry(
          new Error(
            `campaign.launch returned ${launchResp.status} ${launchResp.statusText}`,
          ),
          {
            context: 'onboarding.persistPledgeAndComplete.launchCampaign',
            status: launchResp.status,
            campaignId: effectiveCampaignId,
          },
        )
        return false
      }
    } catch (error) {
      reportErrorToSentry(error, {
        context: 'onboarding.persistPledgeAndComplete.launchCampaign',
        campaignId: effectiveCampaignId,
      })
      return false
    }
    // Launch flips isActive + recomputes raceTargetMetrics on the next read.
    // Invalidate so /dashboard's CampaignProvider refetches the hydrated
    // campaign instead of serving the stale (or missing-metrics) entry that
    // was cached earlier in this session.
    void queryClient.invalidateQueries({ queryKey: CAMPAIGN_QUERY_KEY })
    trackEvent(EVENTS.OnboardingV2.PledgeCompleted, {
      campaignId: effectiveCampaignId,
      pledgeVersion: PLEDGE_VERSION,
    })
    if (user?.id) {
      await identifyUser(user.id, {
        pledgeCompleted: true,
        onboardingCompleted: true,
      })
    }
    return true
  }

  const goNext = async () => {
    if (!canContinue || isAdvancingRef.current) return
    isAdvancingRef.current = true
    try {
      await runGoNext()
    } finally {
      isAdvancingRef.current = false
    }
  }

  const runGoNext = async () => {
    if (activeStep.id === 'welcome') {
      trackEvent(EVENTS.OnboardingV2.WelcomeCompleted, {
        campaignId: campaign?.id,
      })
    }
    if (activeStep.id === 'path-to-victory' && (liveCampaign || campaign)) {
      const trackedCampaign = liveCampaign ?? campaign
      trackEvent(EVENTS.OnboardingV2.VotesNeededCompleted, {
        campaignId: trackedCampaign?.id,
        winNumber: trackedCampaign?.raceTargetMetrics?.winNumber ?? 0,
      })
    }
    if (
      activeStep.id === 'office-selection' &&
      answers.structuredOffice &&
      !isSavingOffice
    ) {
      setIsSavingOffice(true)
      try {
        // campaignId is undefined for new users — the campaign is created
        // inside persist*Office below. Intentional: this is a click signal.
        trackEvent(EVENTS.OnboardingV2.OfficeNextClicked, {
          campaignId: liveCampaign?.id ?? campaign?.id,
        })
        const ok = await persistStructuredOffice(answers.structuredOffice)
        if (!ok) return
        // Pre-warm the success-page LLM sections now that raceId +
        // electionDate are persisted. Both endpoints poll on mount, but
        // firing here gives them a ~15-90s head start so sections are usually
        // ready by the time the user lands. Fire-and-forget — both helpers
        // swallow errors and gp-api dedupes via the per-pod inFlight slot, so
        // pre-warm + success-page mount collapse to a single LLM run.
        //
        // Gated on the strategy-only cohort (campaign-strategy on,
        // campaign-story off): they land on the legacy success page. No point
        // spending Gemini calls for campaign-story users (who generate on
        // demand after their story, and whose events come from the tracker)
        // or flag-off users (routed straight to /dashboard).
        if (campaignStrategyEnabled && !campaignStoryEnabled) {
          // These prewarm calls are the real first request for the strategic
          // landscape and community events, so the `Requested` events fire
          // here (not on the success page, which only re-polls afterward).
          const planCampaignId = liveCampaign?.id ?? campaign?.id
          trackEvent(EVENTS.OnboardingV2.StrategicLandscapeRequested, {
            campaignId: planCampaignId,
          })
          trackEvent(EVENTS.OnboardingV2.CommunityEventsRequested, {
            campaignId: planCampaignId,
          })
          void prewarmStrategicLandscape()
          void prewarmCommunityEvents()
        }
        router.refresh()
      } finally {
        setIsSavingOffice(false)
      }
    }
    if (
      activeStep.id === 'manual-office-entry' &&
      answers.manualOfficeForm &&
      !isSavingOffice
    ) {
      setIsSavingOffice(true)
      try {
        // campaignId is undefined for new users — the campaign is created
        // inside persist*Office below. Intentional: this is a click signal.
        trackEvent(EVENTS.OnboardingV2.OfficeNextClicked, {
          campaignId: liveCampaign?.id ?? campaign?.id,
        })
        const ok = await persistManualOffice(answers.manualOfficeForm)
        if (!ok) return
        router.refresh()
      } finally {
        setIsSavingOffice(false)
      }
    }
    if (activeStep.id === 'ballot-status' && answers.ballotStatus) {
      if (campaign) {
        const updated = await updateCampaign([
          { key: 'details.ballotStatus', value: answers.ballotStatus },
        ])
        if (updated === false) return
      }
      const candidateStage = ballotStatusToCandidateStage[answers.ballotStatus]
      trackEvent(EVENTS.OnboardingV2.BallotStatusCompleted, {
        campaignId: campaign?.id,
        ballotStatus: answers.ballotStatus,
      })
      if (user?.id) {
        await identifyUser(user.id, {
          candidateStage: candidateStage.toLowerCase(),
          hasNotYetFiled: candidateStage !== 'FILED' ? true : undefined,
        })
      }
    }
    if (activeStep.id === 'party-affiliation' && answers.partyAffiliation) {
      const ok = await persistPartyAffiliation(answers.partyAffiliation)
      if (!ok) return
    }
    if (activeStep.id === 'campaign-story') {
      if (storyComplete && !storyGenFiredRef.current) {
        storyGenFiredRef.current = true
        // Fire-and-forget: the endpoint 400s for manual-office campaigns (no
        // raceId) and prewarmStrategicLandscape swallows that, so a candidate
        // is never blocked from reaching the pledge.
        void prewarmStrategicLandscape()
        trackEvent(EVENTS.OnboardingV2.CampaignStoryCompleted, {
          campaignId: liveCampaign?.id ?? campaign?.id,
        })
      } else if (
        !storyComplete &&
        !storyGenFiredRef.current &&
        !storySkippedFiredRef.current
      ) {
        storySkippedFiredRef.current = true
        trackEvent(EVENTS.OnboardingV2.CampaignStorySkipped, {
          campaignId: liveCampaign?.id ?? campaign?.id,
        })
      }
    }
    if (activeStep.id === 'pledge') {
      const effectiveCampaign = campaign ?? liveCampaign
      if (!effectiveCampaign) return
      const ok = await persistPledgeAndComplete()
      if (!ok) return
      // Campaign-story users land on the Campaign Manager home, whose chat
      // opens with the story intake (the plan + tracker are generated from
      // the story later). Otherwise: campaign-strategy on →
      // /onboarding/success (legacy LLM plan); off → /dashboard (legacy).
      router.push(
        resolvePostPledgeRoute({
          campaignStoryEnabled,
          campaignStrategyEnabled,
        }),
      )
      return
    }
    if (nextStep) {
      if (campaign) {
        const updated = await updateCampaign([
          { key: 'data.currentStep', value: nextStep.id },
          { key: 'data.onboarding', value: answers },
        ])
        if (updated === false) return
      }
      setActiveStepId(nextStep.id)
    }
  }

  const handleCantFindOffice = () => {
    setAnswers((current) => ({
      ...current,
      officePath: 'manual',
      manualOffice: true,
      unmatchedOffice: true,
      structuredOffice: undefined,
    }))
    const visibleAfter = getVisibleOnboardingSteps(effectiveSteps, {
      ...answers,
      officePath: 'manual',
    })
    const currentIndex = visibleAfter.findIndex(
      (step) => step.id === activeStepId,
    )
    const next = visibleAfter[currentIndex + 1]
    if (next) {
      setActiveStepId(next.id)
    }
  }

  return (
    <div className="min-h-screen bg-base-surface pb-28 text-foreground">
      <OnboardingTopBar
        currentStep={activeStepNumber}
        totalSteps={visibleSteps.length}
      />
      <main className="mx-auto w-full max-w-4xl px-4 pt-24 pb-6 sm:px-8 sm:pt-28 sm:pb-8">
        <div>
          <div
            className={`grid grid-cols-1 gap-8${
              activeStep.whyThisMatters && !isP2vBlocking
                ? ' md:grid-cols-[minmax(0,1fr)_280px] md:items-start'
                : ''
            }`}
          >
            <section
              className={`space-y-8${
                activeStep.id === 'welcome' ? ' text-center' : ''
              }`}
            >
              {isP2vBlocking ? null : (
                <div className="space-y-4">
                  <h1 className="text-4xl font-bold text-foreground sm:text-5xl">
                    {activeStep.title}
                  </h1>
                  <p className="text-lg text-muted-foreground sm:text-base">
                    {activeStep.id === 'path-to-victory' && p2vOfficeName ? (
                      <>
                        We use historical voter data and proprietary models to
                        get the most accurate projections for{' '}
                        <span className="font-semibold text-foreground">
                          {p2vOfficeName}
                        </span>
                        .
                      </>
                    ) : (
                      activeStep.description
                    )}
                  </p>
                </div>
              )}

              <StepBody
                activeStep={activeStep}
                answers={answers}
                updateAnswers={updateAnswers}
                onCantFindOffice={handleCantFindOffice}
                onOfficeHydratingChange={handleOfficeHydratingChange}
                liveCampaign={liveCampaign}
                onP2vLoadingChange={handleP2vLoadingChange}
                onP2vMetricsResolved={handleP2vMetricsResolved}
                p2vOfficeName={p2vOfficeName}
                skipP2vReveal={hasResolvedPathToVictory}
                onStoryCompleteChange={setStoryComplete}
              />
            </section>

            {activeStep.whyThisMatters && !isP2vBlocking ? (
              <aside
                className="md:fixed md:top-28 md:w-[280px]"
                style={{
                  right: 'max(2rem, calc((100vw - 56rem) / 2 + 2rem))',
                }}
              >
                {activeStep.id === 'path-to-victory' ? (
                  <WhyThisMatters title="You can do this!">
                    Most candidates think they need to convince{' '}
                    <em>everyone</em>. You don&apos;t. You need to find{' '}
                    {liveCampaign?.raceTargetMetrics?.winNumber
                      ? `${numberFormatter(
                          liveCampaign.raceTargetMetrics.winNumber,
                        )} people`
                      : 'your win number'}
                    , talk to them, and make sure they vote. We&apos;ll show you
                    exactly what that takes.
                  </WhyThisMatters>
                ) : (
                  <WhyThisMatters text={activeStep.whyThisMatters} />
                )}
              </aside>
            ) : null}
          </div>
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 bg-base-surface">
        <div className="mx-auto flex h-20 w-full max-w-4xl items-center justify-between px-4 sm:px-8 border-t border-base-border">
          <Button
            type="button"
            variant="ghost"
            size="large"
            onClick={goBack}
            disabled={!previousStep}
          >
            Back
          </Button>
          <Button
            type="button"
            variant="default"
            size="large"
            onClick={goNext}
            disabled={!canContinue}
          >
            {nextStep
              ? activeStep.id === 'campaign-story'
                ? storyComplete
                  ? 'Continue'
                  : 'Skip for now'
                : 'Continue'
              : activeStep.id === 'pledge'
                ? campaignStoryEnabled
                  ? 'Agree & Continue'
                  : 'Agree & Create My Plan'
                : 'Complete'}
          </Button>
        </div>
      </div>
    </div>
  )
}
