'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Checkbox, Input, Label, Textarea } from '@styleguide'
import { cn } from '@styleguide/lib/utils'
import { LoaderCircle, Pencil } from 'lucide-react'
import { clientRequest } from 'gpApi/typed-request'
import type {
  ElectedOffice,
  MyElectedOffice,
  Organization,
} from 'gpApi/api-endpoints'
import type { OnboardingPriorityOption } from '@goodparty_org/contracts'
import { setCookie } from 'helpers/cookieHelper'
import { ORG_SLUG_COOKIE } from '@shared/organizations/constants'
import { reportErrorToSentry } from '@shared/sentry'
import { useSnackbar } from 'helpers/useSnackbar'
import type { SelectedOffice } from 'app/onboarding/components/onboardingTypes'
import { RadioCardGroup } from 'app/onboarding/components/RadioCardGroup'
import { WhyThisMatters } from 'app/onboarding/components/WhyThisMatters'
import OnboardingTopBar from 'app/onboarding/shared/OnboardingTopBar'
import { MajorPartyBlockedAlert } from 'app/onboarding/shared/partisanParty'
import { PRIORITY_FORM_COPY } from 'app/dashboard/priorities/priorityFormCopy'
import { useServeCitizenPanelsFlag } from '@shared/experiments/serveCitizenPanelsFlag'
import ServeOfficePicker from './ServeOfficePicker'
import { DistrictStoryStep } from './districtStory/DistrictStoryStep'
import {
  buildDisabledRanges,
  CALENDAR_END,
  CALENDAR_START,
  formatDisplay,
  overlapsExisting as overlapsExistingRanges,
  TermDatesFields,
  termDateError,
  termDatesValid,
  toApiDate,
  toDate,
  type DisabledRange,
} from './termDates.shared'
import {
  buildBrSuggestionChangedPayload,
  trackServeOnboarding,
  SERVE_ONBOARDING_EVENTS,
  SERVE_STORY_EVENTS,
  type BrPrefillSnapshot,
} from './serveOnboardingAnalytics'
import {
  firstStepAfterTerm,
  isServeStoryStep,
  resolveConfirmEntryStep,
  resolveServeBranch,
  resolveServeResumeStep,
  shouldSeedInOfficeOnResume,
  getServeProgress,
  isServeMajorParty,
  SERVE_IN_OFFICE_OPTIONS,
  SERVE_PARTY_OPTIONS,
  SERVE_CITIZEN_PANELS_PLEDGE_BUTTON,
  SERVE_CITIZEN_PANELS_STEP_COPY,
  SERVE_CITIZEN_PANELS_WELCOME_VALUE_PROPS,
  SERVE_PLEDGE_COMMITMENTS,
  SERVE_STEP_COPY,
  SERVE_WELCOME_VALUE_PROPS,
  type InOfficeStatus,
  SERVE_STORY_STEPS,
  type ServeBranch,
  type ServeStepId,
} from './serveOnboardingConfig'

const DEFAULT_OFFICE_LABEL = 'your elected office'

// The priorities step waits this long for starter issues, then shows what it
// has and keeps checking in the background so late issues still appear.
const STARTER_ISSUES_WAIT_MS = 10_000
const STARTER_ISSUES_POLL_MS = 4_000
const STARTER_ISSUES_POLL_LIMIT_MS = 120_000

// Screens whose "Viewed" event fires once on view (in a useEffect). The two
// selection screens (`inOffice`, `party`) are deliberately absent: their
// "Viewed" events carry the chosen card title and so fire on Continue instead.
const SERVE_STEP_VIEWED_EVENTS: Partial<Record<ServeStepId, string>> = {
  welcome: SERVE_ONBOARDING_EVENTS.WelcomeViewed,
  office: SERVE_ONBOARDING_EVENTS.OfficeViewed,
  confirm: SERVE_ONBOARDING_EVENTS.ConfirmViewed,
  'term-dates': SERVE_ONBOARDING_EVENTS.TermDatesViewed,
  pledge: SERVE_ONBOARDING_EVENTS.PledgeViewed,
  'story-represent': SERVE_STORY_EVENTS['story-represent'].viewed,
  'story-loudest': SERVE_STORY_EVENTS['story-loudest'].viewed,
  'story-sample': SERVE_STORY_EVENTS['story-sample'].viewed,
  'story-grow': SERVE_STORY_EVENTS['story-grow'].viewed,
  priorities: SERVE_ONBOARDING_EVENTS.PrioritiesViewed,
}

export default function ServeOnboardingFlow(): React.JSX.Element {
  const { errorSnackbar } = useSnackbar()
  // The load effect waits on `ready`, so the step list and resume target are
  // chosen once with the real answer and the wrong welcome never flashes.
  const { ready: flagReady, enabled: citizenPanels } =
    useServeCitizenPanelsFlag()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [step, setStep] = useState<ServeStepId>('welcome')
  const [branch, setBranch] = useState<ServeBranch>('net-new')
  // Office/term-dates are reachable as detours from `confirm` in the prefill
  // branch. This flag routes Continue/Back back to `confirm` instead of
  // advancing through the net-new order.
  const [returnToConfirm, setReturnToConfirm] = useState(false)
  const [switchToCampaign, setSwitchToCampaign] = useState(false)
  // The district story's intro plays once a session, not on every visit.
  const [storyIntroPlayed, setStoryIntroPlayed] = useState(false)

  const [currentEO, setCurrentEO] = useState<ElectedOffice | null>(null)
  // Mirror of `currentEO` for synchronous reads inside async save handlers, so
  // create-on-first-answer is single-flight: the EO id created by one Continue
  // is visible to the next save call before React has re-rendered the state.
  const currentEORef = useRef<ElectedOffice | null>(null)
  const [otherRanges, setOtherRanges] = useState<DisabledRange[]>([])

  // UX-only: drives the onboarding branch (e.g. `campaigning` hands off to the
  // Win flow) and gates Continue. Intentionally not persisted to the EO record.
  const [inOffice, setInOffice] = useState<InOfficeStatus | null>(null)
  const [party, setParty] = useState<string | null>(null)

  const [office, setOffice] = useState<SelectedOffice | undefined>(undefined)
  const [customOfficeName, setCustomOfficeName] = useState('')
  const [officeLabel, setOfficeLabel] = useState<string>(DEFAULT_OFFICE_LABEL)
  const [orgPositionId, setOrgPositionId] = useState<string | undefined>(
    undefined,
  )
  // True once the office is on the EO org server-side, which is what the
  // community issues search reads. A pick that is not saved yet does not count.
  const [officeOnOrg, setOfficeOnOrg] = useState(false)
  // The issues they ran on, carried over from their Win campaign, already give
  // the priorities step something to offer.
  const [hasWinIssues, setHasWinIssues] = useState(false)
  const [zip, setZip] = useState<string | undefined>(undefined)
  const [manualEntry, setManualEntry] = useState(false)

  const [termStartDate, setTermStartDate] = useState<Date | undefined>(
    undefined,
  )
  const [termEndDate, setTermEndDate] = useState<Date | undefined>(undefined)

  // Null until the priorities step loads them; reset on Back from the pledge
  // so a return visit shows what was saved, including a typed issue as its
  // own option.
  const [priorityOptions, setPriorityOptions] = useState<
    OnboardingPriorityOption[] | null
  >(null)
  const [priorityLoadFailed, setPriorityLoadFailed] = useState(false)
  const [selectedPriorityKeys, setSelectedPriorityKeys] = useState<Set<string>>(
    new Set(),
  )
  const [otherPrioritySelected, setOtherPrioritySelected] = useState(false)
  // When the priorities step stops checking for late starter issues.
  const starterIssuesPollUntilRef = useRef(0)
  const [otherPriorityTitle, setOtherPriorityTitle] = useState('')
  const [otherPriorityDescription, setOtherPriorityDescription] = useState('')
  const otherPriorityComplete =
    otherPrioritySelected &&
    otherPriorityTitle.trim().length > 0 &&
    otherPriorityDescription.trim().length > 0

  // Snapshot of the BallotReady-officeholder prefill the lead landed on, frozen
  // at load before the user edits anything. Null = net-new (no officeholder
  // record / personId), which makes the completion-time "BR Suggestion Changed"
  // event report `hadBrPrefill: false`. Used to diff the BR suggestion against
  // the user's final pick so we can measure how inaccurate BallotReady data is.
  const [brPrefill, setBrPrefill] = useState<BrPrefillSnapshot | null>(null)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [step, loading, switchToCampaign])

  useEffect(() => {
    if (!flagReady) return
    void (async () => {
      try {
        const [currentRes, mineRes] = await Promise.all([
          clientRequest(
            'GET /v1/elected-office/current',
            {},
            { ignoreResponseError: true },
          ),
          clientRequest(
            'GET /v1/elected-office/mine',
            {},
            { ignoreResponseError: true },
          ),
        ])

        const currentEOData = currentRes.ok
          ? (currentRes.data as ElectedOffice)
          : null
        const mine = mineRes.ok ? (mineRes.data as MyElectedOffice[]) : []
        // `current` resolves only the active-slug org's office, so it 404s when
        // a campaign org is the active org. Fall back to the user's own offices
        // (preferring one whose onboarding is unfinished) before treating them
        // as net-new — otherwise persist() would POST a duplicate office
        // instead of editing the EO sales already provisioned for this lead.
        const eo =
          currentEOData ??
          mine.find((office) => !office.onboardingCompletedAt) ??
          mine[0] ??
          null
        setCurrentEO(eo)
        currentEORef.current = eo
        setHasWinIssues(
          !!eo && !!mine.find((office) => office.id === eo.id)?.hasWinIssues,
        )

        let officePrefilled = false
        let prefillPositionId: string | undefined = undefined
        let prefillPositionName: string | undefined = undefined

        if (eo) {
          // Pin the EO org as the active context up front so every in-flow
          // clientRequest (voter-issues / contacts-stats derive the district
          // from this org's position) targets `eo-<id>` rather than a stale
          // candidate org — not just at persist().
          setCookie(ORG_SLUG_COOKIE, `eo-${eo.id}`)
          setParty(eo.party ?? null)
          setTermStartDate(toDate(eo.termStartDate))
          setTermEndDate(toDate(eo.termEndDate))

          const orgRes = await clientRequest(
            'GET /v1/organizations/:slug',
            { slug: `eo-${eo.id}` },
            { ignoreResponseError: true },
          )
          if (orgRes.ok) {
            const org = orgRes.data as Organization
            if (org.positionName) {
              setOfficeLabel(org.positionName)
              prefillPositionName = org.positionName
              officePrefilled = true
            }
            if (org.position?.brPositionId) {
              setOrgPositionId(org.position.brPositionId)
              prefillPositionId = org.position.brPositionId
              officePrefilled = true
            }
          }
        }
        if (officePrefilled) setOfficeOnOrg(true)

        const disabledRanges = buildDisabledRanges(mine, eo?.id)
        setOtherRanges(disabledRanges)

        const termPrefilled = !!(eo?.termStartDate || eo?.termEndDate)
        // Resume markers from the persisted record. `party` is the user's first
        // real answer (welcome/inOffice persist nothing), so it signals the
        // user has started; term dates count as set only when BOTH bounds are
        // present, mirroring the flow's both-bounds requirement.
        const hasParty = !!eo?.party
        const hasDates = !!(eo?.termStartDate && eo?.termEndDate)

        // Branch off the explicit `selfReported` marker rather than inferring
        // from which fields happen to be populated. A net-new user who picked
        // their own office and a sales/BR prefill BOTH end up with a position on
        // the org, so populated fields can't tell them apart — the marker can.
        // `resolveServeBranch` keeps a self-reported record net-new (no
        // misleading confirm hub, no snapshot for the user's own pick) while a
        // prefill (marker absent) with any office/term data stays prefill, so
        // its BR suggestion-accuracy snapshot still fires — even a partial one.
        const isPrefill =
          resolveServeBranch({
            officePresent: officePrefilled,
            datesPresent: termPrefilled,
            selfReported: !!eo?.selfReported,
          }) === 'prefill'
        const resolvedBranch: ServeBranch = isPrefill ? 'prefill' : 'net-new'
        // Freeze the BR suggestion now, before any edits, normalizing the term
        // dates through the same yyyy-MM-dd round-trip the final pick uses so
        // the from/to diff is apples-to-apples. The single suggested position
        // is also the user's lone known BR-officeholder position here, so it
        // doubles as the officeholder-position set for the match check.
        setBrPrefill(
          isPrefill
            ? {
                positionId: prefillPositionId,
                positionName: prefillPositionName,
                termStartDate:
                  toApiDate(toDate(eo?.termStartDate)) ?? undefined,
                termEndDate: toApiDate(toDate(eo?.termEndDate)) ?? undefined,
                officeholderPositionIds: prefillPositionId
                  ? [prefillPositionId]
                  : [],
              }
            : null,
        )
        setBranch(resolvedBranch)

        // Route to the persisted step checkpoint (the exact most recent step,
        // written on every Continue) when present, clamped so it can't outrun
        // the persisted data; otherwise fall back to the data-derived first
        // unanswered step (legacy rows / prefills provisioned before the
        // checkpoint existed still run the intro from `welcome` when un-started).
        const resumeStep = resolveServeResumeStep(
          resolvedBranch,
          eo?.onboardingStep as ServeStepId | null | undefined,
          { hasParty, hasOffice: officePrefilled, hasDates },
          citizenPanels,
        )
        // Prompt-first confirm gating: a prefill that resumes onto the `confirm`
        // hub with a missing office or invalid/absent term dates is routed to
        // fill that piece FIRST (office, then term dates) rather than landing on
        // confirm with a red error. `officePrefilled` alone isn't enough — a
        // position id without a display name still shows the placeholder label —
        // so office-readiness mirrors the render's `officeIsChosen` (a resolved
        // position NAME). Arm the return-to-confirm detour so the collection
        // step's Continue brings the user back to re-evaluate.
        let landingStep = resumeStep
        if (resumeStep === 'confirm') {
          landingStep = resolveConfirmEntryStep({
            officeReady: !!prefillPositionName,
            datesReady: termDatesValid(
              toDate(eo?.termStartDate),
              toDate(eo?.termEndDate),
              disabledRanges,
            ),
          })
          if (landingStep !== 'confirm') setReturnToConfirm(true)
        }
        // Seed the UX-only `inOffice` answer whenever we resume past the intro,
        // so backing up to the inOffice step isn't a dead end (its Continue gate
        // needs a selection) and a mis-click on "still campaigning" can't eject
        // a resumed official into the Win flow. Resuming AT welcome/inOffice
        // leaves it unset for the user to choose.
        if (shouldSeedInOfficeOnResume(landingStep)) setInOffice('in-office')
        setStep(landingStep)
      } catch (err) {
        reportErrorToSentry(err, { context: 'serveOnboarding.load' })
        setBranch('net-new')
      } finally {
        setLoading(false)
      }
    })()
  }, [flagReady])

  // Disqualification event: picking a major party (Democrat/Republican) surfaces
  // the blocking alert and keeps Continue disabled. Dedupe to once per session
  // via a ref so toggling between the two doesn't spam the event — mirrors the
  // Win flow's `PartyDesignationBlocked` tracking. Gated on the party step so a
  // returning EO whose stored `party` hydrates to a major value on load (via
  // setParty(eo.party)) doesn't emit the event before the user is actually on
  // the step — the Win flow's partyAffiliation only ever changes via step UI.
  const partyBlockedFiredRef = useRef(false)
  useEffect(() => {
    if (
      step === 'party' &&
      isServeMajorParty(party) &&
      !partyBlockedFiredRef.current
    ) {
      partyBlockedFiredRef.current = true
      trackServeOnboarding(SERVE_ONBOARDING_EVENTS.PartyBlocked, {
        electedOfficeId: currentEO?.id,
        party,
      })
    }
  }, [step, party, currentEO?.id])

  // Per-screen funnel instrumentation: fire each screen's dedicated "Viewed"
  // event once when the user lands on it (deduped via a Set ref so a
  // back-and-forth — e.g. the prefill confirm→office→confirm detour, or
  // stepping Back — doesn't re-fire and inflate the funnel). Gated on
  // `!loading` so the initial render and resume-step resolution settle first,
  // and so a resumed user only logs the screens they actually view this
  // session. The `inOffice` and `party` screens are intentionally NOT fired
  // here: their "Viewed" events carry the user's selected card title, so they
  // fire on Continue (see handleContinue) once the selection is known.
  const viewedStepsRef = useRef<Set<ServeStepId>>(new Set())
  useEffect(() => {
    if (loading) return
    const viewedEvent = SERVE_STEP_VIEWED_EVENTS[step]
    if (!viewedEvent) return
    if (viewedStepsRef.current.has(step)) return
    viewedStepsRef.current.add(step)
    trackServeOnboarding(viewedEvent, {
      branch,
      electedOfficeId: currentEO?.id,
    })
  }, [loading, step, branch, currentEO?.id])

  // Research is paid. Without issues they ran on, it starts as early as it
  // can so the priorities step has something to offer. With them, it waits
  // until the official has said they are in office, so nobody who is still
  // campaigning or just testing spends it.
  const researchAllowed =
    !hasWinIssues ||
    (inOffice === 'in-office' && step !== 'welcome' && step !== 'inOffice')

  useEffect(() => {
    if (
      loading ||
      step !== 'priorities' ||
      priorityOptions !== null ||
      priorityLoadFailed
    ) {
      return
    }
    let cancelled = false
    starterIssuesPollUntilRef.current =
      Date.now() + STARTER_ISSUES_POLL_LIMIT_MS
    void (async () => {
      try {
        await ensureElectedOffice()
        const starting =
          communityIssuesStartRef.current ??
          (researchAllowed ? startCommunityIssues() : Promise.resolve())
        await Promise.race([
          starting,
          new Promise((resolve) => setTimeout(resolve, STARTER_ISSUES_WAIT_MS)),
        ])
        const res = await clientRequest('GET /v1/priorities/onboarding', {})
        if (cancelled) return
        setPriorityOptions(res.data.options)
        setSelectedPriorityKeys(
          new Set(res.data.options.filter((o) => o.selected).map((o) => o.key)),
        )
      } catch (err) {
        reportErrorToSentry(err, { context: 'serveOnboarding.loadPriorities' })
        if (!cancelled) setPriorityLoadFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loading, step, priorityOptions, priorityLoadFailed])

  // Starter issues can land after the list first loads. Keep checking until
  // they do, then add them without touching what the official already picked.
  const priorityOptionsLoaded = priorityOptions !== null
  const hasCommunityOptions =
    priorityOptions?.some((option) => option.kind === 'community') ?? false
  useEffect(() => {
    if (
      step !== 'priorities' ||
      !priorityOptionsLoaded ||
      hasCommunityOptions
    ) {
      return
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const check = async () => {
      if (cancelled || Date.now() >= starterIssuesPollUntilRef.current) return
      try {
        const res = await clientRequest('GET /v1/priorities/onboarding', {})
        if (cancelled) return
        const community = res.data.options.filter(
          (option) => option.kind === 'community',
        )
        if (community.length > 0) {
          setPriorityOptions((prev) => {
            const shown = new Set((prev ?? []).map((option) => option.key))
            return [
              ...(prev ?? []),
              ...community.filter((option) => !shown.has(option.key)),
            ]
          })
          setSelectedPriorityKeys((prev) => {
            const next = new Set(prev)
            for (const option of community) {
              if (option.selected) next.add(option.key)
            }
            return next
          })
          return
        }
      } catch (err) {
        reportErrorToSentry(err, {
          context: 'serveOnboarding.pollStarterIssues',
        })
      }
      timer = setTimeout(check, STARTER_ISSUES_POLL_MS)
    }
    timer = setTimeout(check, STARTER_ISSUES_POLL_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [step, priorityOptionsLoaded, hasCommunityOptions])

  // One-shot guards for the two selection screens whose "Viewed" event fires on
  // Continue (with the chosen card title) rather than on view, so re-advancing
  // after a Back doesn't double-count them.
  const officeStatusViewedRef = useRef(false)
  const partyViewedRef = useRef(false)

  const officeIsChosen = Boolean(
    office?.positionId ||
    customOfficeName.trim() ||
    // In the prefill branch the office may already be set on the EO org and
    // never re-picked in this session.
    (branch === 'prefill' && officeLabel !== DEFAULT_OFFICE_LABEL),
  )

  // Start the search the moment the office is on the org and research is
  // allowed: on load for a prefill or resumed official, right after the
  // office is saved for a net-new one.
  useEffect(() => {
    if (loading || !citizenPanels || !officeOnOrg || !researchAllowed) return
    void startCommunityIssues()
  }, [loading, citizenPanels, officeOnOrg, researchAllowed])

  const datesValid =
    !!termStartDate &&
    !!termEndDate &&
    termStartDate < termEndDate &&
    !overlapsExistingRanges(termStartDate, termEndDate, otherRanges)

  const dateError = useMemo(
    () => termDateError(termStartDate, termEndDate, otherRanges),
    [termStartDate, termEndDate, otherRanges],
  )

  const officeDisplayLabel = office?.positionName
    ? office.positionName
    : customOfficeName.trim()
      ? customOfficeName.trim()
      : officeLabel

  // Both the freshly-picked office id and the prefilled org position id are
  // BallotReady position ids. The district story routes exclusively through
  // orgPositionId so contacts-stats derives the L2 district from the EO org's
  // position pointer (param-less) — the same path the Win flow uses — instead
  // of campaign-scoped resolution an EO has no campaign for.
  const storyPositionId = office?.positionId ?? orgPositionId

  const progress = getServeProgress(branch, step, citizenPanels)
  const afterTerm = firstStepAfterTerm(citizenPanels)

  // Tracks which BR position id we've already written to the EO org so a
  // back-and-forth through the district story doesn't re-PATCH needlessly.
  const patchedOfficeRef = useRef<string | undefined>(undefined)

  // Create-on-first-answer: a truly net-new user has no ElectedOffice to write
  // to, so the incremental saves used to silently no-op and nothing reached the
  // DB until the final completion POST. Instead, lazily create the EO the first
  // time we need an id (the inOffice Continue — the user's first real answer,
  // gated so a Win-flow switcher never mints one), then PUT/PATCH against it on
  // every subsequent step. The backend create() is idempotent per user (advisory lock
  // + placeholder adoption), so a sales/magic-link stub is reused rather than
  // duplicated, and a double create returns the same record. Returns null only
  // when creation fails, in which case the caller degrades gracefully (the
  // session keeps answers in state and the completion POST is the safety net).
  const ensureElectedOffice = async (): Promise<ElectedOffice | null> => {
    if (currentEORef.current) return currentEORef.current
    const created = await clientRequest('POST /v1/elected-office', {})
    if (!created.ok || !created.data) return null
    const eo = created.data as ElectedOffice
    currentEORef.current = eo
    setCurrentEO(eo)
    // Pin the EO org so subsequent in-flow requests (and the office PATCH below)
    // resolve against `eo-<id>` rather than a stale candidate org.
    setCookie(ORG_SLUG_COOKIE, `eo-${eo.id}`)
    return eo
  }

  // The office PATCH payload for the chosen office, or undefined when no office
  // is chosen this session (e.g. a prefill the user never re-picked) so no
  // needless PATCH fires.
  const officePayload = ():
    | {
        ballotReadyPositionId: string | null
        customPositionName: string | null
      }
    | undefined => {
    const positionId = office?.positionId
    const custom = customOfficeName.trim()
    if (!positionId && !custom) return undefined
    return {
      ballotReadyPositionId: positionId ?? null,
      customPositionName: custom || null,
    }
  }

  // Single incremental write for a Continue: ensure the EO exists, optionally
  // PATCH the chosen office onto its org (idempotent via patchedOfficeRef), then
  // PUT the step's data fields together with the `onboardingStep` checkpoint.
  // Folding the checkpoint into the data PUT keeps them atomic — a failed write
  // leaves neither the answer nor a checkpoint that outruns it. onboardingCompletedAt
  // is never sent here, so the completion guard stays untouched.
  // Writes quick starter issues for the office, then starts the full community
  // issues research, so the priorities step can offer real local issues. Kept
  // as a promise so that step can wait on it. A failed start stays in the ref
  // so later steps never refire it; only the priorities step's Try again
  // starts one fresh attempt.
  const communityIssuesStartRef = useRef<Promise<void> | null>(null)
  const communityIssuesFailedRef = useRef(false)
  const startCommunityIssues = (): Promise<void> => {
    if (communityIssuesStartRef.current) return communityIssuesStartRef.current
    const started = clientRequest('POST /v1/community-issues/onboarding', {})
      .then(() => undefined)
      .catch((err: Error) => {
        reportErrorToSentry(err, { context: 'serveOnboarding.communityIssues' })
        communityIssuesFailedRef.current = true
      })
    communityIssuesStartRef.current = started
    return started
  }

  const saveProgress = async ({
    targetStep,
    eoFields,
    office: officeToPatch,
  }: {
    targetStep: ServeStepId
    eoFields?: {
      party?: string
      termStartDate?: string | null
      termEndDate?: string | null
      selfReported?: boolean
    }
    office?: {
      ballotReadyPositionId: string | null
      customPositionName: string | null
    }
  }): Promise<void> => {
    const eo = await ensureElectedOffice()
    if (!eo) return
    if (officeToPatch) {
      const patchKey =
        officeToPatch.ballotReadyPositionId ??
        `custom:${officeToPatch.customPositionName ?? ''}`
      if (patchedOfficeRef.current !== patchKey) {
        await clientRequest('PATCH /v1/organizations/:slug', {
          slug: `eo-${eo.id}`,
          ballotReadyPositionId: officeToPatch.ballotReadyPositionId,
          customPositionName: officeToPatch.customPositionName,
        })
        patchedOfficeRef.current = patchKey
        setOfficeOnOrg(true)
      }
    }
    await clientRequest('PUT /v1/elected-office/:id', {
      id: eo.id,
      ...eoFields,
      onboardingStep: targetStep,
    })
  }

  // Run a best-effort incremental save, then advance. A failed save logs to
  // Sentry but never blocks navigation — the session keeps the answer in state
  // and the final persist() rewrites everything at completion, so resume just
  // misses that one checkpoint rather than trapping the user.
  const persistAndAdvance = async (
    args: Parameters<typeof saveProgress>[0],
    applyNav: () => void,
    context: string,
  ): Promise<void> => {
    setSaving(true)
    try {
      await saveProgress(args)
    } catch (err) {
      reportErrorToSentry(err, { context })
    } finally {
      setSaving(false)
      applyNav()
    }
  }

  // Priorities are the point of this step, so unlike the other checkpoints a
  // failed save keeps the user here to retry instead of advancing silently.
  const savePrioritiesAndAdvance = async (): Promise<void> => {
    if (priorityOptions === null) return
    const trackCompleted = () =>
      trackServeOnboarding(SERVE_ONBOARDING_EVENTS.PrioritiesCompleted, {
        branch,
        electedOfficeId: currentEO?.id,
        shownCount: priorityOptions.length,
        selectedCount: selectedPriorityKeys.size,
        wroteOwn: otherPriorityComplete,
      })
    if (priorityOptions.length === 0 && !otherPriorityComplete) {
      trackCompleted()
      await persistAndAdvance(
        { targetStep: 'pledge' },
        () => setStep('pledge'),
        'serveOnboarding.checkpoint.priorities',
      )
      return
    }
    setSaving(true)
    try {
      const eo = await ensureElectedOffice()
      if (!eo) throw new Error('No elected office to save priorities to')
      await clientRequest('PUT /v1/priorities/onboarding', {
        shownKeys: priorityOptions.map((option) => option.key),
        selectedKeys: [...selectedPriorityKeys],
        other: otherPriorityComplete
          ? [
              {
                title: otherPriorityTitle.trim(),
                description: otherPriorityDescription.trim(),
              },
            ]
          : [],
      })
    } catch (err) {
      reportErrorToSentry(err, { context: 'serveOnboarding.savePriorities' })
      errorSnackbar('We couldn’t save your priorities. Please try again.')
      setSaving(false)
      return
    }
    trackCompleted()
    await persistAndAdvance(
      { targetStep: 'pledge' },
      () => setStep('pledge'),
      'serveOnboarding.checkpoint.priorities',
    )
  }

  const retryPriorities = () => {
    if (communityIssuesFailedRef.current) {
      communityIssuesFailedRef.current = false
      communityIssuesStartRef.current = null
    }
    setPriorityLoadFailed(false)
  }

  const togglePriority = (key: string) => {
    setSelectedPriorityKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const persist = async (): Promise<void> => {
    setSaving(true)
    const nowIso = new Date().toISOString()
    const body = {
      termStartDate: toApiDate(termStartDate),
      termEndDate: toApiDate(termEndDate),
      party,
      pledgedAt: nowIso,
      onboardingCompletedAt: nowIso,
      // Stamp the marker at completion too, so a net-new user whose incremental
      // saves never landed (creation failed throughout → POST fallback below)
      // still records it. Omitted in the prefill branch so the record stays
      // classified as a prefill.
      ...(branch === 'net-new' ? { selfReported: true } : {}),
      onboardingStep: 'pledge' as const,
      ...(office?.positionId
        ? { ballotReadyPositionId: office.positionId }
        : {}),
      ...(customOfficeName.trim()
        ? { customPositionName: customOfficeName.trim() }
        : {}),
    }

    try {
      // The EO was almost always created earlier (create-on-first-answer), so
      // completion is a PUT. ensureElectedOffice covers the rare case where
      // every prior create failed: it makes one last attempt, and only if THAT
      // also fails do we fall back to a completion POST (which carries the full
      // body, so nothing is lost).
      const eo = await ensureElectedOffice()
      let electedOfficeId = eo?.id

      if (eo) {
        if (office?.positionId || customOfficeName.trim()) {
          await clientRequest('PATCH /v1/organizations/:slug', {
            slug: `eo-${eo.id}`,
            ballotReadyPositionId: office?.positionId ?? null,
            customPositionName: customOfficeName.trim() || null,
          })
        }
        await clientRequest('PUT /v1/elected-office/:id', {
          id: eo.id,
          ...body,
        })
      } else {
        const created = await clientRequest('POST /v1/elected-office', body)
        electedOfficeId = (created.data as ElectedOffice).id
      }

      // Diff the BallotReady suggestion against what the user actually saved.
      // Only emit when there was a prefill the user diverged from — `office`,
      // `termDates`, or `both` — so the event stays true to its name and the
      // payload measures how accurate BallotReady's officeholder data was.
      const brSuggestion = buildBrSuggestionChangedPayload({
        electedOfficeId,
        prefill: brPrefill,
        selected: {
          positionId: office?.positionId ?? orgPositionId,
          positionName: officeDisplayLabel,
          termStartDate: toApiDate(termStartDate) ?? undefined,
          termEndDate: toApiDate(termEndDate) ?? undefined,
        },
      })
      if (brSuggestion.hadBrPrefill && brSuggestion.changedField) {
        // Await so the event flushes before the redirect below unloads the page.
        await trackServeOnboarding(
          SERVE_ONBOARDING_EVENTS.SuggestionChanged,
          brSuggestion,
        )
      }

      // Pledge submitted: the per-screen completion of the final pledge step.
      // Awaited (like the events around it) so it flushes before the redirect.
      await trackServeOnboarding(SERVE_ONBOARDING_EVENTS.PledgeCompleted, {
        branch,
        electedOfficeId,
      })

      // The established serve completion metric (kept as-is). Await so the
      // event flushes before the redirect below unloads the page.
      await trackServeOnboarding(SERVE_ONBOARDING_EVENTS.Completed, {
        electedOfficeId,
      })

      // Pin the elected-office org so the serve dashboard (and every
      // clientRequest scoped by X-Organization-Slug) resolves the EO instead
      // of bouncing the user back into the candidate/Win flow. Mirrors the Win
      // flow's setCookie(ORG_SLUG_COOKIE, 'campaign-<id>') pattern, then routes
      // through post-auth-redirect so the cookie + serve context are
      // established before landing on the Chief of Staff home.
      if (electedOfficeId) {
        setCookie(ORG_SLUG_COOKIE, `eo-${electedOfficeId}`)
      }
      const handoff = new URLSearchParams({
        next: '/dashboard/chief-of-staff',
      })
      if (electedOfficeId) handoff.set('org', `eo-${electedOfficeId}`)
      window.location.href = `/post-auth-redirect?${handoff.toString()}`
    } catch (err) {
      reportErrorToSentry(err, { context: 'serveOnboarding.persist' })
      errorSnackbar('We couldn’t save your office. Please try again.')
      setSaving(false)
    }
  }

  // Prompt-first entry to the prefill confirm hub: route to the first
  // missing/invalid piece (office, then term dates) so confirm is only ever
  // shown once both are present and valid. A collection-step detour arms
  // `returnToConfirm` so that step's Continue/Back loops back here to
  // re-evaluate; once everything is ready we land on confirm and clear the flag.
  const enterConfirmHub = () => {
    const target = resolveConfirmEntryStep({
      officeReady: officeIsChosen,
      datesReady: datesValid,
    })
    setReturnToConfirm(target !== 'confirm')
    setStep(target)
  }

  // The step Back returns to from a prefill office/term-dates detour: the
  // confirm hub when it's satisfiable, otherwise the prior real step (`party`),
  // so a prompt-first detour for still-missing data doesn't bounce off the gate.
  const backFromConfirmDetour = (): ServeStepId =>
    officeIsChosen && datesValid ? 'confirm' : 'party'

  // Navigation only. The "BR Suggestion Changed" event is emitted at completion
  // (see persist) where the user's FINAL office/dates are known and can be
  // diffed against the BR prefill — clicking "Change" here is just intent, the
  // pick isn't settled yet.
  const goToOfficeFromConfirm = () => {
    setReturnToConfirm(true)
    setManualEntry(false)
    setStep('office')
  }

  const goToDatesFromConfirm = () => {
    setReturnToConfirm(true)
    setStep('term-dates')
  }

  const handleContinue = () => {
    switch (step) {
      case 'welcome':
        // Navigation only — deliberately do NOT create the EO here. Welcome is a
        // pure intro with no answer, and the very next step lets the user pick
        // "still campaigning", which hands off to the Win flow. Minting an EO on
        // this Continue would strand a campaigning user with a dangling
        // onboardingCompletedAt:null record that the `mine` resume fallback would
        // later drag them back into serve onboarding with. Create-on-first-answer
        // is deferred to the inOffice Continue (the first real "I'm in office").
        setStep('inOffice')
        return
      case 'inOffice': {
        // The office-status "Viewed" event carries the user's selected card
        // title, so it fires here (once) rather than on view. Firing on BOTH
        // the campaigning and non-campaigning paths captures the "still
        // campaigning" hand-off as a `selection` value — the funnel drop-off
        // signal that the removed standalone "Switched to Campaign" event used
        // to provide.
        if (!officeStatusViewedRef.current && inOffice) {
          officeStatusViewedRef.current = true
          trackServeOnboarding(SERVE_ONBOARDING_EVENTS.OfficeStatusViewed, {
            branch,
            electedOfficeId: currentEO?.id,
            selection: SERVE_IN_OFFICE_OPTIONS.find((o) => o.value === inOffice)
              ?.title,
          })
        }
        if (inOffice === 'campaigning') {
          setSwitchToCampaign(true)
          return
        }
        // Create-on-first-answer: this non-campaigning Continue is the user's
        // first real commitment to the serve flow, so it mints the EO (for
        // net-new users with none) and writes the first `party` checkpoint. A
        // user who picked "campaigning" above returns before reaching here, so
        // no EO is ever created for a Win-flow switcher.
        void persistAndAdvance(
          { targetStep: 'party' },
          () => setStep('party'),
          'serveOnboarding.checkpoint.inOffice',
        )
        return
      }
      case 'party': {
        // The party-designation "Viewed" event carries the chosen party card
        // title, so it fires here (once) rather than on view. Continue is gated
        // on a non-major-party pick, so this only fires for valid selections
        // that proceed; major-party picks are covered by PartyDesignationBlocked.
        if (!partyViewedRef.current && party) {
          partyViewedRef.current = true
          trackServeOnboarding(SERVE_ONBOARDING_EVENTS.PartyDesignationViewed, {
            branch,
            electedOfficeId: currentEO?.id,
            selection: SERVE_PARTY_OPTIONS.find((o) => o.value === party)
              ?.title,
          })
        }
        // The party PUT also stamps the net-new `selfReported` marker (the
        // record's first user-driven write): the office the user picks next
        // lands on the org indistinguishably from a prefill, so we record HERE
        // that this is the user's own net-new entry. Prefill leaves it untouched.
        //
        // Prefill checkpoints at `confirm` but navigates through the prompt-first
        // gate (enterConfirmHub), which detours to office/term-dates first when
        // either is still missing instead of dropping the user on confirm.
        const target = branch === 'prefill' ? 'confirm' : 'office'
        void persistAndAdvance(
          {
            targetStep: target,
            eoFields: {
              party: party ?? undefined,
              ...(branch === 'net-new' ? { selfReported: true } : {}),
            },
          },
          branch === 'prefill' ? enterConfirmHub : () => setStep('office'),
          'serveOnboarding.persistPartyProgress',
        )
        return
      }
      case 'office': {
        // Office picker completed: carry the selected office title on the
        // dedicated completion event (the natural moment a selection exists).
        trackServeOnboarding(SERVE_ONBOARDING_EVENTS.OfficeCompleted, {
          branch,
          electedOfficeId: currentEO?.id,
          selection: officeDisplayLabel,
        })
        // On the prefill detour, re-enter the confirm hub through the gate
        // (enterConfirmHub) — picking an office may still leave term dates to
        // collect, in which case it forwards to term-dates rather than confirm.
        const target = returnToConfirm ? 'confirm' : 'term-dates'
        void persistAndAdvance(
          { targetStep: target, office: officePayload() },
          returnToConfirm ? enterConfirmHub : () => setStep('term-dates'),
          'serveOnboarding.persistOfficeProgress',
        )
        return
      }
      case 'term-dates': {
        const target = returnToConfirm ? 'confirm' : afterTerm
        void persistAndAdvance(
          {
            targetStep: target,
            eoFields: {
              termStartDate: toApiDate(termStartDate),
              termEndDate: toApiDate(termEndDate),
            },
            // Carry the office pointer forward to the EO org before the
            // district story (idempotent if already patched) so its
            // org-derived district data can resolve. Skipped on the confirm
            // detour, which only edits dates.
            ...(returnToConfirm ? {} : { office: officePayload() }),
          },
          // Continue is gated on valid dates here, so the confirm detour returns
          // straight to the (now satisfiable) hub via enterConfirmHub.
          returnToConfirm ? enterConfirmHub : () => setStep(afterTerm),
          'serveOnboarding.persistTermDatesProgress',
        )
        return
      }
      case 'confirm':
        void persistAndAdvance(
          { targetStep: afterTerm, office: officePayload() },
          () => setStep(afterTerm),
          'serveOnboarding.persistOfficeProgress',
        )
        return
      case 'story-represent':
      case 'story-loudest':
      case 'story-sample':
      case 'story-grow': {
        // The story collects nothing, so it moves on at once and saves the
        // checkpoint behind it: waiting on the save would hold the next
        // step's motion.
        const next =
          SERVE_STORY_STEPS[SERVE_STORY_STEPS.indexOf(step) + 1] ?? 'priorities'
        trackServeOnboarding(SERVE_STORY_EVENTS[step].completed, {
          branch,
          electedOfficeId: currentEO?.id,
        })
        setStep(next)
        saveProgress({ targetStep: next }).catch((err: Error) =>
          reportErrorToSentry(err, {
            context: 'serveOnboarding.checkpoint.story',
          }),
        )
        return
      }
      case 'priorities':
        void savePrioritiesAndAdvance()
        return
      case 'pledge':
        void persist()
        return
      default:
        return
    }
  }

  const handleBack = () => {
    switch (step) {
      case 'inOffice':
        setStep('welcome')
        return
      case 'party':
        setStep('inOffice')
        return
      case 'office':
        if (returnToConfirm) {
          setReturnToConfirm(false)
          setStep(backFromConfirmDetour())
        } else {
          setStep('party')
        }
        return
      case 'term-dates':
        if (returnToConfirm) {
          // The term-dates detour is only reachable when an office is already
          // chosen, so backing out always returns to the confirm hub. (Unlike
          // the office detour, dates are invalid by construction here, so
          // backFromConfirmDetour would wrongly fall back to `party`.)
          setReturnToConfirm(false)
          setStep('confirm')
        } else {
          setStep('office')
        }
        return
      case 'confirm':
        setStep('party')
        return
      case 'story-represent':
        setStep(branch === 'prefill' ? 'confirm' : 'term-dates')
        return
      case 'story-loudest':
      case 'story-sample':
      case 'story-grow':
        setStep(SERVE_STORY_STEPS[SERVE_STORY_STEPS.indexOf(step) - 1]!)
        return
      case 'priorities':
        setStep('story-grow')
        return
      case 'pledge':
        if (citizenPanels) {
          setPriorityOptions(null)
          setOtherPrioritySelected(false)
          setOtherPriorityTitle('')
          setOtherPriorityDescription('')
          setStep('priorities')
        } else {
          setStep(branch === 'prefill' ? 'confirm' : 'term-dates')
        }
        return
      default:
        return
    }
  }

  const canContinue = useMemo(() => {
    switch (step) {
      case 'inOffice':
        return inOffice !== null
      case 'party':
        // GoodParty.org doesn't support partisan officials, so a major-party
        // pick blocks Continue (the user sees the partisan-block alert).
        return party !== null && !isServeMajorParty(party)
      case 'office':
        return officeIsChosen
      case 'term-dates':
        return datesValid
      case 'confirm':
        return officeIsChosen && datesValid
      case 'priorities':
        // A checked Other must be filled in, so it is never dropped silently.
        // With nothing found to pick, the step can be skipped.
        return (
          priorityOptions !== null &&
          (otherPrioritySelected
            ? otherPriorityComplete
            : selectedPriorityKeys.size > 0 || priorityOptions.length === 0)
        )
      default:
        return true
    }
  }, [
    step,
    inOffice,
    party,
    officeIsChosen,
    datesValid,
    priorityOptions,
    selectedPriorityKeys,
    otherPrioritySelected,
    otherPriorityComplete,
  ])

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <LoaderCircle className="animate-spin" />
      </div>
    )
  }

  if (switchToCampaign) {
    return (
      <div className="min-h-screen bg-base-surface pb-28 text-foreground">
        <OnboardingTopBar
          currentStep={progress.current}
          totalSteps={progress.total}
        />
        <SwitchToCampaignStep onBack={() => setSwitchToCampaign(false)} />
      </div>
    )
  }

  // The current step's explainer copy. When present it renders in the right
  // rail on wide viewports and stacks below the content on narrow ones — the
  // same responsive treatment as the Win flow's "Why this matters" aside.
  const whyThisMatters = isServeStoryStep(step)
    ? undefined
    : SERVE_STEP_COPY[step].whyWeAsk

  return (
    <div className="min-h-screen bg-base-surface pb-28 text-foreground">
      <OnboardingTopBar
        currentStep={progress.current}
        totalSteps={progress.total}
      />

      <main className="mx-auto w-full max-w-4xl px-4 pt-24 pb-6 sm:px-8 sm:pt-28 sm:pb-8">
        <div
          className={cn(
            'grid grid-cols-1 gap-8',
            whyThisMatters &&
              'md:grid-cols-[minmax(0,1fr)_280px] md:items-start',
          )}
        >
          <section
            className={cn('space-y-8', step === 'welcome' && 'text-center')}
          >
            {step === 'welcome' && (
              <WelcomeStep citizenPanels={citizenPanels} />
            )}
            {step === 'inOffice' && (
              <InOfficeStep value={inOffice} onChange={setInOffice} />
            )}
            {step === 'party' && (
              <PartyStep value={party} onChange={setParty} />
            )}
            {step === 'office' && (
              <OfficeStep
                office={office}
                customOfficeName={customOfficeName}
                manualEntry={manualEntry}
                zip={zip}
                onZipChange={setZip}
                onSelectOffice={(selected) => {
                  setOffice(selected)
                  setCustomOfficeName('')
                }}
                onCustomOfficeNameChange={setCustomOfficeName}
                onEnableManual={() => setManualEntry(true)}
                onDisableManual={() => setManualEntry(false)}
              />
            )}
            {step === 'term-dates' && (
              <TermDatesStep
                termStartDate={termStartDate}
                termEndDate={termEndDate}
                onStartChange={setTermStartDate}
                onEndChange={setTermEndDate}
                otherRanges={otherRanges}
                calendarStart={CALENDAR_START}
                calendarEnd={CALENDAR_END}
                error={dateError}
              />
            )}
            {step === 'confirm' && (
              <ConfirmStep
                officeLabel={officeDisplayLabel}
                termStartDate={termStartDate}
                termEndDate={termEndDate}
                onChangeOffice={goToOfficeFromConfirm}
                onChangeDates={goToDatesFromConfirm}
              />
            )}
            {isServeStoryStep(step) && (
              <DistrictStoryStep
                step={step}
                eoId={currentEO?.id}
                positionId={storyPositionId}
                place={office?.city}
                introPlayed={storyIntroPlayed}
                onIntroPlayed={() => setStoryIntroPlayed(true)}
              />
            )}
            {citizenPanels && step === 'priorities' && (
              <PrioritiesStep
                options={priorityOptions}
                loadFailed={priorityLoadFailed}
                onRetry={retryPriorities}
                selectedKeys={selectedPriorityKeys}
                onToggle={togglePriority}
                otherSelected={otherPrioritySelected}
                onOtherSelectedChange={setOtherPrioritySelected}
                otherTitle={otherPriorityTitle}
                onOtherTitleChange={setOtherPriorityTitle}
                otherDescription={otherPriorityDescription}
                onOtherDescriptionChange={setOtherPriorityDescription}
              />
            )}
            {step === 'pledge' && <PledgeStep citizenPanels={citizenPanels} />}
          </section>

          {whyThisMatters && (
            <aside
              className="md:fixed md:top-28 md:w-[280px]"
              style={{
                right: 'max(2rem, calc((100vw - 56rem) / 2 + 2rem))',
              }}
            >
              <WhyThisMatters text={whyThisMatters} />
            </aside>
          )}
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 bg-base-surface">
        <div className="mx-auto flex h-20 w-full max-w-4xl items-center justify-between border-t border-base-border px-4 sm:px-8">
          <Button
            type="button"
            variant="ghost"
            size="large"
            onClick={handleBack}
            disabled={saving || step === 'welcome'}
          >
            Back
          </Button>
          <Button
            type="button"
            variant="default"
            size="large"
            onClick={handleContinue}
            disabled={!canContinue || saving}
            loading={saving}
          >
            {step !== 'pledge'
              ? 'Continue'
              : citizenPanels
                ? SERVE_CITIZEN_PANELS_PLEDGE_BUTTON
                : 'Agree & Continue'}
          </Button>
        </div>
      </div>
    </div>
  )
}

const Panel = ({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}): React.JSX.Element => (
  <div
    className={cn(
      'rounded-xl border border-base-border bg-card text-card-foreground',
      className,
    )}
  >
    {children}
  </div>
)

const StepHeading = ({
  title,
  description,
  center = false,
}: {
  title: string
  description: string
  center?: boolean
}): React.JSX.Element => (
  <div className={center ? 'text-center' : undefined}>
    <h1 className="text-4xl font-bold text-foreground sm:text-5xl">{title}</h1>
    <p className="mt-4 text-base leading-relaxed text-muted-foreground">
      {description}
    </p>
  </div>
)

const WelcomeStep = ({
  citizenPanels,
}: {
  citizenPanels: boolean
}): React.JSX.Element => {
  const copy = citizenPanels
    ? SERVE_CITIZEN_PANELS_STEP_COPY.welcome
    : SERVE_STEP_COPY.welcome
  const valueProps = citizenPanels
    ? SERVE_CITIZEN_PANELS_WELCOME_VALUE_PROPS
    : SERVE_WELCOME_VALUE_PROPS
  return (
    <div>
      <h1 className="text-4xl font-bold text-foreground sm:text-5xl">
        {copy.title}
      </h1>
      <p className="mt-4 text-base leading-relaxed text-muted-foreground">
        {copy.description}
      </p>

      <div className="mt-10 grid gap-4 text-left sm:grid-cols-2">
        {valueProps.map((prop) => {
          const Icon = prop.icon
          return (
            <Panel key={prop.title} className="p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <div className="mt-4 font-semibold text-foreground">
                {prop.title}
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {prop.desc}
              </p>
            </Panel>
          )
        })}
      </div>
    </div>
  )
}

const InOfficeStep = ({
  value,
  onChange,
}: {
  value: InOfficeStatus | null
  onChange: (value: InOfficeStatus) => void
}): React.JSX.Element => {
  const copy = SERVE_STEP_COPY.inOffice
  return (
    <div>
      <StepHeading title={copy.title} description={copy.description} />
      <div className="mt-8">
        <RadioCardGroup
          name="serve-in-office"
          value={value ?? undefined}
          onChange={onChange}
          options={SERVE_IN_OFFICE_OPTIONS.map((option) => ({
            value: option.value,
            title: option.title,
            description: option.desc,
          }))}
        />
      </div>
    </div>
  )
}

const PartyStep = ({
  value,
  onChange,
}: {
  value: string | null
  onChange: (value: string) => void
}): React.JSX.Element => {
  const copy = SERVE_STEP_COPY.party
  return (
    <div>
      <StepHeading title={copy.title} description={copy.description} />
      {isServeMajorParty(value) && (
        <div className="mt-8">
          <MajorPartyBlockedAlert />
        </div>
      )}
      <div className="mt-8">
        <RadioCardGroup
          name="serve-party"
          value={value ?? undefined}
          onChange={onChange}
          options={SERVE_PARTY_OPTIONS.map((option) => ({
            value: option.value,
            title: option.title,
            description: option.desc,
          }))}
        />
      </div>
    </div>
  )
}

const OfficeStep = ({
  office,
  customOfficeName,
  manualEntry,
  zip,
  onZipChange,
  onSelectOffice,
  onCustomOfficeNameChange,
  onEnableManual,
  onDisableManual,
}: {
  office: SelectedOffice | undefined
  customOfficeName: string
  manualEntry: boolean
  zip: string | undefined
  onZipChange: (zip: string) => void
  onSelectOffice: (office: SelectedOffice | undefined) => void
  onCustomOfficeNameChange: (value: string) => void
  onEnableManual: () => void
  onDisableManual: () => void
}): React.JSX.Element => {
  const copy = SERVE_STEP_COPY.office
  return (
    <div>
      <StepHeading title={copy.title} description={copy.description} />

      <Panel className="mt-8 p-4 sm:p-6">
        {manualEntry ? (
          <div className="space-y-2">
            <Label htmlFor="custom-office">Office name</Label>
            <Input
              id="custom-office"
              placeholder="e.g. Springfield City Council, Ward 3"
              value={customOfficeName}
              onChange={(event) => onCustomOfficeNameChange(event.target.value)}
            />
            <Button
              type="button"
              variant="link"
              size="small"
              onClick={onDisableManual}
            >
              Search for my office instead
            </Button>
          </div>
        ) : (
          <ServeOfficePicker
            zip={zip}
            selected={office}
            onZipChange={onZipChange}
            onSelect={onSelectOffice}
            onCantFindOffice={onEnableManual}
          />
        )}
      </Panel>
    </div>
  )
}

const TermDatesStep = ({
  termStartDate,
  termEndDate,
  onStartChange,
  onEndChange,
  otherRanges,
  calendarStart,
  calendarEnd,
  error,
}: {
  termStartDate: Date | undefined
  termEndDate: Date | undefined
  onStartChange: (date: Date | undefined) => void
  onEndChange: (date: Date | undefined) => void
  otherRanges: DisabledRange[]
  calendarStart: Date
  calendarEnd: Date
  error: string | null
}): React.JSX.Element => {
  const copy = SERVE_STEP_COPY['term-dates']
  return (
    <div>
      <StepHeading title={copy.title} description={copy.description} />

      <Panel className="mt-8 p-4 sm:p-6">
        <TermDatesFields
          termStartDate={termStartDate}
          termEndDate={termEndDate}
          onStartChange={onStartChange}
          onEndChange={onEndChange}
          otherRanges={otherRanges}
          calendarStart={calendarStart}
          calendarEnd={calendarEnd}
          error={error}
        />
      </Panel>
    </div>
  )
}

const ConfirmRow = ({
  label,
  value,
  onChange,
  changeLabel,
}: {
  label: string
  value: string
  onChange: () => void
  changeLabel: string
}): React.JSX.Element => (
  <div className="flex items-start justify-between gap-4 py-4">
    <div className="min-w-0">
      <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div className="mt-1 font-medium break-words text-foreground">
        {value}
      </div>
    </div>
    <Button type="button" variant="link" size="small" onClick={onChange}>
      <Pencil />
      {changeLabel}
    </Button>
  </div>
)

// The confirm hub is reached only once the office and valid term dates are both
// present (prompt-first routing detours to fill any missing piece first — see
// enterConfirmHub / resolveConfirmEntryStep), so this screen always shows
// real values and never the old red error-on-confirm state.
const ConfirmStep = ({
  officeLabel,
  termStartDate,
  termEndDate,
  onChangeOffice,
  onChangeDates,
}: {
  officeLabel: string
  termStartDate: Date | undefined
  termEndDate: Date | undefined
  onChangeOffice: () => void
  onChangeDates: () => void
}): React.JSX.Element => {
  const copy = SERVE_STEP_COPY.confirm
  const datesValue = `${formatDisplay(termStartDate)} – ${formatDisplay(termEndDate)}`
  return (
    <div>
      <StepHeading title={copy.title} description={copy.description} />

      <Panel className="mt-8 px-6">
        <div className="divide-y divide-base-border">
          <ConfirmRow
            label="Office"
            value={officeLabel}
            onChange={onChangeOffice}
            changeLabel="Change office"
          />
          <ConfirmRow
            label="Term dates"
            value={datesValue}
            onChange={onChangeDates}
            changeLabel="Change dates"
          />
        </div>
      </Panel>
    </div>
  )
}

const CheckboxCard = ({
  id,
  checked,
  title,
  desc,
  disabled = false,
  onCheckedChange,
}: {
  id: string
  checked: boolean
  title: string
  desc?: string
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}): React.JSX.Element => (
  <Label
    htmlFor={id}
    className={cn(
      'flex w-full items-start gap-3 rounded-xl border border-base-border bg-card p-5 text-left transition-all',
      disabled ? 'cursor-default' : 'cursor-pointer hover:border-primary/50',
      checked && 'border-primary bg-primary/5 ring-2 ring-primary/20',
    )}
  >
    <Checkbox
      id={id}
      checked={checked}
      disabled={disabled}
      onCheckedChange={(value) => onCheckedChange(value === true)}
      className="mt-0.5"
    />
    <span className="block">
      <span className="block font-semibold text-foreground">{title}</span>
      {desc && (
        <span className="mt-1 block text-sm font-normal text-muted-foreground">
          {desc}
        </span>
      )}
    </span>
  </Label>
)

const PRIORITY_KIND_ORDER: OnboardingPriorityOption['kind'][] = [
  'ran_on',
  'community',
  'other',
]

const PrioritiesStep = ({
  options,
  loadFailed,
  onRetry,
  selectedKeys,
  onToggle,
  otherSelected,
  onOtherSelectedChange,
  otherTitle,
  onOtherTitleChange,
  otherDescription,
  onOtherDescriptionChange,
}: {
  options: OnboardingPriorityOption[] | null
  loadFailed: boolean
  onRetry: () => void
  selectedKeys: Set<string>
  onToggle: (key: string) => void
  otherSelected: boolean
  onOtherSelectedChange: (checked: boolean) => void
  otherTitle: string
  onOtherTitleChange: (value: string) => void
  otherDescription: string
  onOtherDescriptionChange: (value: string) => void
}): React.JSX.Element => {
  const copy = SERVE_STEP_COPY.priorities
  return (
    <div>
      <StepHeading title={copy.title} description={copy.description} />

      {loadFailed ? (
        <div className="mt-8 flex flex-col items-center gap-3 text-sm text-muted-foreground">
          <p>We couldn’t load issues for your community.</p>
          <Button type="button" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        </div>
      ) : options === null ? (
        <div className="mt-8 flex flex-col items-center gap-3 text-sm text-muted-foreground">
          <LoaderCircle className="animate-spin" />
          Finding issues in your community
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          {options.length === 0 && (
            <p className="text-sm text-muted-foreground">
              We couldn’t find issues for your area yet. Add one under Other, or
              skip this for now.
            </p>
          )}
          {PRIORITY_KIND_ORDER.flatMap((kind) =>
            options
              .filter((option) => option.kind === kind)
              .map((option) => (
                <CheckboxCard
                  key={option.key}
                  id={`priority-${option.key}`}
                  checked={selectedKeys.has(option.key)}
                  title={option.title}
                  desc={option.description || undefined}
                  disabled={kind === 'ran_on'}
                  onCheckedChange={() => onToggle(option.key)}
                />
              )),
          )}

          <CheckboxCard
            id="priority-other"
            checked={otherSelected}
            title="Other"
            desc="Add an issue that isn't listed here."
            onCheckedChange={onOtherSelectedChange}
          />
          {otherSelected && (
            <div className="space-y-3 pt-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="priority-other-title">
                  {PRIORITY_FORM_COPY.titleLabel}
                </Label>
                <Input
                  id="priority-other-title"
                  placeholder={PRIORITY_FORM_COPY.titlePlaceholder}
                  maxLength={PRIORITY_FORM_COPY.titleMaxLength}
                  value={otherTitle}
                  onChange={(event) => onOtherTitleChange(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="priority-other-description">
                  {PRIORITY_FORM_COPY.descriptionLabel}
                </Label>
                <Textarea
                  id="priority-other-description"
                  rows={3}
                  placeholder={PRIORITY_FORM_COPY.descriptionPlaceholder}
                  maxLength={PRIORITY_FORM_COPY.descriptionMaxLength}
                  value={otherDescription}
                  onChange={(event) =>
                    onOtherDescriptionChange(event.target.value)
                  }
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const PledgeStep = ({
  citizenPanels,
}: {
  citizenPanels: boolean
}): React.JSX.Element => {
  const copy = citizenPanels
    ? SERVE_CITIZEN_PANELS_STEP_COPY.pledge
    : SERVE_STEP_COPY.pledge
  return (
    <div>
      <StepHeading title={copy.title} description={copy.description} />

      <Panel className="mt-8 p-6 sm:p-8">
        <h2 className="mb-6 text-2xl leading-[1.08] font-bold text-foreground sm:text-3xl">
          I pledge to be...
        </h2>
        <div className="space-y-6">
          {SERVE_PLEDGE_COMMITMENTS.map((commitment) => {
            const Icon = commitment.icon
            return (
              <div key={commitment.title}>
                <div className="flex items-center gap-2">
                  <Icon className="h-5 w-5 text-foreground" />
                  <h3 className="text-xl font-semibold text-foreground">
                    {commitment.title}
                  </h3>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-foreground">
                  {commitment.detail}
                </p>
              </div>
            )
          })}
        </div>
        <p className="mt-6 text-left text-xs leading-relaxed text-muted-foreground">
          By continuing, you agree to serve with civility focused on issues, not
          mudslinging or ad hominem attacks; also accepting GoodParty.org&apos;s{' '}
          <a
            href="https://goodparty.org/terms-of-service"
            className="underline hover:text-foreground"
          >
            Terms of Service
          </a>{' '}
          and{' '}
          <a
            href="https://goodparty.org/privacy-policy"
            className="underline hover:text-foreground"
          >
            Privacy Policy
          </a>
          .
        </p>
      </Panel>
    </div>
  )
}

const SwitchToCampaignStep = ({
  onBack,
}: {
  onBack: () => void
}): React.JSX.Element => {
  const handleSwitch = () => {
    // "Still campaigning" belongs in the candidate/Win onboarding, not serve.
    // Hand off to the Win flow's entry point. The hand-off itself is captured
    // as the `selection: "I'm still campaigning"` value on the Office Status
    // Viewed event (fired on the inOffice Continue), so no event fires here.
    window.location.href = '/onboarding/office-selection'
  }
  return (
    <>
      <main className="mx-auto w-full max-w-4xl px-4 pt-24 pb-6 sm:px-8 sm:pt-28 sm:pb-8">
        <h1 className="text-4xl font-bold text-foreground sm:text-5xl">
          Let&apos;s get you set up for your campaign
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          This part of GoodParty.org is for officials already in office, so
          we&apos;ll take you to the campaign tools.
        </p>
      </main>

      <div className="fixed inset-x-0 bottom-0 bg-base-surface">
        <div className="mx-auto flex h-20 w-full max-w-4xl items-center justify-between border-t border-base-border px-4 sm:px-8">
          <Button type="button" variant="ghost" size="large" onClick={onBack}>
            Back
          </Button>
          <Button
            type="button"
            variant="default"
            size="large"
            onClick={handleSwitch}
          >
            Switch to Campaign
          </Button>
        </div>
      </div>
    </>
  )
}
