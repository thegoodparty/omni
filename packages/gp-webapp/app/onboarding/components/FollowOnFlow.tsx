'use client'

import { Alert, AlertDescription, Button } from '@styleguide'
import { CircleAlert } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import { clientRequest } from 'gpApi/typed-request'
import { clientFetch } from 'gpApi/clientFetch'
import { apiRoutes } from 'gpApi/routes'
import type { Organization } from 'gpApi/api-endpoints'
import { setCookie } from 'helpers/cookieHelper'
import { ORG_SLUG_COOKIE } from '@shared/organizations/constants'
import { CAMPAIGN_QUERY_KEY } from '@shared/hooks/CampaignProvider'
import {
  ELIGIBILITY_QUERY_KEY,
  ORGANIZATIONS_QUERY_KEY,
} from '@shared/organization-picker'
import { reportErrorToSentry } from '@shared/sentry'
import type { Campaign } from 'helpers/types'
import { updateCampaign } from '../shared/ajaxActions'
import OnboardingTopBar from '../shared/OnboardingTopBar'
import { buildFollowOnPayload } from './followOnPayload'
import { FOLLOW_ON_STEPS, firstFollowOnStepId } from './followOnConfig'
import { getVisibleOnboardingSteps } from './onboardingHelpers'
import { OfficeSelectionStep } from './OfficeSelectionStep'
import { ManualOfficeEntryStep } from './ManualOfficeEntryStep'
import { PathToVictoryStep } from './PathToVictoryStep'
import { VoterDemographicsStep } from './VoterDemographicsStep'
import { PledgeStep } from './PledgeStep'
import { RadioCardGroup, type RadioCardOption } from './RadioCardGroup'
import type {
  BallotStatus,
  FollowOnIntent,
  OnboardingAnswers,
  OnboardingStepId,
  PartyAffiliation,
  SelectedOffice,
} from './onboardingTypes'

// These option sets and party mappings intentionally mirror OnboardingFlow's.
// They live here (rather than being shared) so the first-time onboarding flow
// stays untouched by the follow-on work; the copy is plain UI data.
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

interface FollowOnFlowProps {
  intent: FollowOnIntent
  fromOrganizationSlug?: string
}

export default function FollowOnFlow({
  intent,
  fromOrganizationSlug,
}: FollowOnFlowProps): React.JSX.Element {
  const router = useRouter()
  const queryClient = useQueryClient()

  const eligibilityQuery = useQuery({
    queryKey: ELIGIBILITY_QUERY_KEY,
    queryFn: async () =>
      clientRequest('GET /v1/eligibility', {}).then((res) => res.data),
  })
  const organizationsQuery = useQuery({
    queryKey: ORGANIZATIONS_QUERY_KEY,
    queryFn: async () =>
      clientRequest('GET /v1/organizations', {}).then(
        (res) => res.data.organizations,
      ),
  })

  const reelectionOfficeSlug =
    eligibilityQuery.data?.reelectionOfficeSlug ?? null
  // Resolved only to label the path-to-victory step with the held office while
  // the new campaign is still being created.
  const officeName = useMemo(() => {
    const orgs = organizationsQuery.data ?? []
    return (
      orgs.find((org: Organization) => org.slug === reelectionOfficeSlug)
        ?.name ?? 'your office'
    )
  }, [organizationsQuery.data, reelectionOfficeSlug])

  const [answers, setAnswers] = useState<OnboardingAnswers>(() => ({
    // The switcher action the user clicked is the intent; carry the held-office
    // slug for same-office so the server can inherit the position.
    followOnIntent: intent,
    fromOrganizationSlug:
      intent === 'same-office' ? fromOrganizationSlug : undefined,
  }))
  const [activeStepId, setActiveStepId] =
    useState<OnboardingStepId>(firstFollowOnStepId)
  const [liveCampaign, setLiveCampaign] = useState<Campaign | null>(null)
  const [isHydratingOffice, setIsHydratingOffice] = useState(false)
  const [isP2vLoading, setIsP2vLoading] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const isAdvancingRef = useRef(false)
  // Early answers (party / ballot status) collected before the campaign
  // exists. If the post-creation flush fails, they're parked here and retried
  // on the next advance — Back is disabled after creation, so there's no other
  // recovery path.
  const pendingEarlyAttrsRef = useRef<{ key: string; value: string }[] | null>(
    null,
  )

  const ready = !eligibilityQuery.isPending && !organizationsQuery.isPending

  const flowSteps = FOLLOW_ON_STEPS

  const visibleSteps = getVisibleOnboardingSteps(flowSteps, answers)
  const activeIndex = Math.max(
    0,
    visibleSteps.findIndex((step) => step.id === activeStepId),
  )
  const activeStep = visibleSteps[activeIndex] ?? visibleSteps[0]
  const previousStep = activeIndex > 0 ? visibleSteps[activeIndex - 1] : null
  const nextStep = visibleSteps[activeIndex + 1] ?? null

  const isActiveStepValid = activeStep.isValid?.({ answers }) ?? true
  const isP2vBlocking = activeStep.id === 'path-to-victory' && isP2vLoading
  const isOfficeHydrationBlocking =
    activeStep.id === 'office-selection' && isHydratingOffice
  const canContinue =
    isActiveStepValid &&
    !isCreating &&
    !isP2vBlocking &&
    !isOfficeHydrationBlocking

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [activeStepId])

  const updateAnswers = (patch: Partial<OnboardingAnswers>) => {
    setAnswers((current) => ({ ...current, ...patch }))
  }

  const p2vOfficeName =
    answers.structuredOffice?.positionName ||
    liveCampaign?.positionName ||
    liveCampaign?.organization?.customPositionName ||
    liveCampaign?.office ||
    officeName

  const setNewCampaignActive = (campaign: Campaign) => {
    setLiveCampaign(campaign)
    setCookie(ORG_SLUG_COOKIE, `campaign-${campaign.id}`)
    // The new org must appear and become active; eligibility changes now that
    // a fresh active campaign exists. Invalidate all three so the dashboard
    // (and the switcher) reflect the new campaign on arrival.
    void queryClient.invalidateQueries({ queryKey: CAMPAIGN_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: ORGANIZATIONS_QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: ELIGIBILITY_QUERY_KEY })
  }

  const buildEarlyAttrs = (): { key: string; value: string }[] => {
    const attrs: { key: string; value: string }[] = []
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

  // updateCampaign swallows errors and returns false (never throws), so a
  // failed flush is invisible to the outer catch. Park the attrs for retry and
  // surface the failure rather than silently losing party / ballot status.
  const flushEarlyAttrs = async (
    attrs: { key: string; value: string }[],
  ): Promise<boolean> => {
    if (attrs.length === 0) return true
    const flushed = await updateCampaign(attrs)
    if (flushed === false) {
      pendingEarlyAttrsRef.current = attrs
      setErrorMessage(
        'Something went wrong saving your answers. Please try again.',
      )
      return false
    }
    pendingEarlyAttrsRef.current = null
    return true
  }

  // Creates the new campaign via the follow-on endpoint, sets it active, then
  // flushes the early answers collected before creation. Returns false on
  // failure so the caller can halt navigation.
  const createFollowOnCampaign = async (): Promise<boolean> => {
    setIsCreating(true)
    setErrorMessage(null)
    try {
      const { data: campaign } = await clientRequest(
        'POST /v1/campaigns/follow-on',
        buildFollowOnPayload({
          ...answers,
          // The switcher passes the held-office slug via ?from=; fall back to
          // eligibility so a same-office run still inherits the position if the
          // param is absent. The new-office payload ignores this field.
          fromOrganizationSlug:
            answers.fromOrganizationSlug ?? reelectionOfficeSlug ?? undefined,
        }),
      )
      setNewCampaignActive(campaign)
      return await flushEarlyAttrs(buildEarlyAttrs())
    } catch (error) {
      // A retry after the campaign already exists (e.g. a page refresh dropped
      // liveCampaign and re-fired creation) 409s server-side. Recover by
      // resuming on the existing active campaign instead of dead-ending.
      if (error instanceof FetchError && error.status === 409) {
        try {
          const { data: existing } = await clientRequest(
            'GET /v1/campaigns/mine',
            {},
          )
          setNewCampaignActive(existing)
          return await flushEarlyAttrs(buildEarlyAttrs())
        } catch (recoverError) {
          reportErrorToSentry(recoverError, {
            context: 'followOn.createFollowOnCampaign.recover409',
            intent: answers.followOnIntent,
          })
          setErrorMessage(
            'Something went wrong creating your campaign. Please try again.',
          )
          return false
        }
      }
      // The server refuses a same-office run it can't date (no upcoming
      // election resolvable for the held office) with a specific errorCode.
      // Retrying won't help, so give an actionable message — but only for that
      // exact case: the same path also 400s for a missing/invalid source org,
      // which should fall through to the generic handler.
      const errorCode =
        error instanceof FetchError &&
        error.data &&
        typeof error.data === 'object' &&
        'errorCode' in error.data
          ? (error.data as { errorCode?: string }).errorCode
          : undefined
      if (errorCode === 'UNRESOLVED_ELECTION_DATE') {
        reportErrorToSentry(error, {
          context: 'followOn.createFollowOnCampaign.unresolvedElection',
          intent: answers.followOnIntent,
        })
        setErrorMessage(
          "We couldn't find an upcoming election for this office yet. " +
            'Please contact support@goodparty.org and we will help you ' +
            'start your re-election campaign.',
        )
        return false
      }
      reportErrorToSentry(error, {
        context: 'followOn.createFollowOnCampaign',
        intent: answers.followOnIntent,
      })
      setErrorMessage(
        'Something went wrong creating your campaign. Please try again.',
      )
      return false
    } finally {
      setIsCreating(false)
    }
  }

  // The campaign is created as soon as we have what the follow-on endpoint
  // needs: nothing extra for same-office (position inherited), so we create on
  // leaving the first step (welcome); the picked office for new-office, so we
  // create on leaving the office step. After that the new campaign is live for
  // the projection / insights steps, and the remaining answers persist onto it.
  const shouldCreateOnLeaving = (stepId: OnboardingStepId): boolean => {
    if (liveCampaign) return false
    if (answers.followOnIntent === 'same-office') return stepId === 'welcome'
    return stepId === 'office-selection' || stepId === 'manual-office-entry'
  }

  const handleOfficeSelect = (office: SelectedOffice | undefined) => {
    updateAnswers({
      structuredOffice: office,
      officePath: office ? 'structured' : undefined,
      manualOffice: office ? false : undefined,
      unmatchedOffice: office ? false : undefined,
    })
  }

  const handleCantFindOffice = () => {
    updateAnswers({
      officePath: 'manual',
      manualOffice: true,
      unmatchedOffice: true,
      structuredOffice: undefined,
    })
    const visibleAfter = getVisibleOnboardingSteps(flowSteps, {
      ...answers,
      officePath: 'manual',
    })
    const currentIndex = visibleAfter.findIndex((s) => s.id === activeStepId)
    const next = visibleAfter[currentIndex + 1]
    if (next) setActiveStepId(next.id)
  }

  const completePledge = async (): Promise<boolean> => {
    const updated = await updateCampaign([
      { key: 'details.pledged', value: true },
      { key: 'data.currentStep', value: 'onboarding-complete' },
    ])
    if (updated === false) return false
    try {
      const launchResp = await clientFetch(apiRoutes.campaign.launch)
      if (!launchResp.ok) {
        reportErrorToSentry(
          new Error(`campaign.launch returned ${launchResp.status}`),
          {
            context: 'followOn.completePledge.launch',
            campaignId: liveCampaign?.id,
          },
        )
        return false
      }
    } catch (error) {
      reportErrorToSentry(error, {
        context: 'followOn.completePledge.launch',
        campaignId: liveCampaign?.id,
      })
      return false
    }
    void queryClient.invalidateQueries({ queryKey: CAMPAIGN_QUERY_KEY })
    return true
  }

  const runGoNext = async () => {
    // Retry a previously failed early-attrs flush before advancing, so the
    // parked party / ballot-status answers aren't lost on the new campaign.
    if (pendingEarlyAttrsRef.current && liveCampaign) {
      const ok = await flushEarlyAttrs(pendingEarlyAttrsRef.current)
      if (!ok) return
    }

    // Persist per-step edits once the new campaign exists (mirrors the
    // standard flow editing an existing campaign).
    if (
      activeStep.id === 'ballot-status' &&
      answers.ballotStatus &&
      liveCampaign
    ) {
      const ok = await updateCampaign([
        { key: 'details.ballotStatus', value: answers.ballotStatus },
      ])
      if (ok === false) return
    }
    if (
      activeStep.id === 'party-affiliation' &&
      answers.partyAffiliation &&
      liveCampaign
    ) {
      const ok = await updateCampaign([
        {
          key: 'details.party',
          value: partyAffiliationToCampaignParty[answers.partyAffiliation],
        },
      ])
      if (ok === false) return
    }

    if (activeStep.id === 'pledge') {
      if (!liveCampaign) return
      setErrorMessage(null)
      const ok = await completePledge()
      if (!ok) {
        setErrorMessage(
          'Something went wrong finishing your campaign. Please try again.',
        )
        return
      }
      router.push('/dashboard')
      return
    }

    if (shouldCreateOnLeaving(activeStep.id)) {
      const created = await createFollowOnCampaign()
      if (!created) return
    }

    if (nextStep) setActiveStepId(nextStep.id)
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

  const goBack = () => {
    // Once the campaign exists it can't be un-created; block back-navigation
    // (mirrors the disabled Button below).
    if (liveCampaign) return
    if (previousStep) {
      setActiveStepId(previousStep.id)
      return
    }
    // The first step has no in-flow predecessor. Exit to the dashboard rather
    // than trapping the user — this flow is entered from the org switcher.
    router.push('/dashboard')
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-base-surface text-muted-foreground">
        Loading…
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-base-surface pb-28 text-foreground">
      <OnboardingTopBar
        currentStep={activeIndex + 1}
        totalSteps={visibleSteps.length}
      />
      <main className="mx-auto w-full max-w-4xl px-4 pt-24 pb-6 sm:px-8 sm:pt-28 sm:pb-8">
        <section className="space-y-8">
          {isP2vBlocking ? null : (
            <div className="space-y-4">
              <h1 className="text-4xl font-bold text-foreground sm:text-5xl">
                {activeStep.title}
              </h1>
              <p className="text-lg text-muted-foreground sm:text-base">
                {activeStep.description}
              </p>
            </div>
          )}

          {errorMessage ? (
            <Alert variant="destructive" icon={<CircleAlert />}>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          ) : null}

          {activeStep.id === 'ballot-status' && (
            <RadioCardGroup
              name="ballot-status"
              value={answers.ballotStatus}
              onChange={(value) => updateAnswers({ ballotStatus: value })}
              options={ballotStatusOptions}
            />
          )}

          {activeStep.id === 'party-affiliation' && (
            <div className="space-y-4">
              {isMajorPartyAffiliation(answers.partyAffiliation) ? (
                <Alert variant="destructive" icon={<CircleAlert />}>
                  <AlertDescription>
                    Sorry, GoodParty.org is only for non-partisan and
                    independent candidates.
                  </AlertDescription>
                </Alert>
              ) : null}
              <RadioCardGroup
                name="party-affiliation"
                value={answers.partyAffiliation}
                onChange={(value) => updateAnswers({ partyAffiliation: value })}
                options={partyAffiliationOptions}
              />
            </div>
          )}

          {activeStep.id === 'office-selection' && (
            <OfficeSelectionStep
              zip={answers.officeZip}
              selected={answers.structuredOffice}
              onZipChange={(zip) => updateAnswers({ officeZip: zip })}
              onSelect={handleOfficeSelect}
              onCantFindOffice={handleCantFindOffice}
              onHydratingChange={setIsHydratingOffice}
            />
          )}

          {activeStep.id === 'manual-office-entry' && (
            <ManualOfficeEntryStep
              value={answers.manualOfficeForm}
              onChange={(form) => updateAnswers({ manualOfficeForm: form })}
            />
          )}

          {activeStep.id === 'path-to-victory' && (
            <PathToVictoryStep
              campaign={liveCampaign}
              officeName={p2vOfficeName}
              onLoadingChange={setIsP2vLoading}
            />
          )}

          {activeStep.id === 'voter-demographics' && (
            <VoterDemographicsStep
              ballotReadyPositionId={answers.structuredOffice?.positionId}
              orgPositionId={
                liveCampaign?.organization?.positionId ?? undefined
              }
              city={answers.structuredOffice?.city}
              state={answers.structuredOffice?.state}
              office={answers.structuredOffice?.positionName}
            />
          )}

          {activeStep.id === 'pledge' && <PledgeStep />}
        </section>
      </main>

      <div className="fixed inset-x-0 bottom-0 bg-base-surface">
        <div className="mx-auto flex h-20 w-full max-w-4xl items-center justify-between px-4 sm:px-8 border-t border-base-border">
          <Button
            type="button"
            variant="ghost"
            size="large"
            onClick={goBack}
            // Once the campaign exists, going back can't un-create it, so block
            // back-navigation to earlier steps. On the first step (no
            // previousStep) Back exits the flow instead of dead-ending, so it
            // stays enabled there.
            disabled={liveCampaign !== null}
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
              ? 'Continue'
              : activeStep.id === 'pledge'
                ? 'Agree & Create My Plan'
                : 'Complete'}
          </Button>
        </div>
      </div>
    </div>
  )
}
