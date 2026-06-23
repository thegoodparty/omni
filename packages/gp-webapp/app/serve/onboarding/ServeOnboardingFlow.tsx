'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Label } from '@styleguide'
import { cn } from '@styleguide/lib/utils'
import { Check, LoaderCircle, Pencil } from 'lucide-react'
import { clientRequest } from 'gpApi/typed-request'
import type { ElectedOffice, Organization } from 'gpApi/api-endpoints'
import { setCookie } from 'helpers/cookieHelper'
import { ORG_SLUG_COOKIE } from '@shared/organizations/constants'
import { reportErrorToSentry } from '@shared/sentry'
import { useSnackbar } from 'helpers/useSnackbar'
import type { SelectedOffice } from 'app/onboarding/components/onboardingTypes'
import { VoterDemographicsStep } from 'app/onboarding/components/VoterDemographicsStep'
import { WhyThisMatters } from 'app/onboarding/components/WhyThisMatters'
import OnboardingTopBar from 'app/onboarding/shared/OnboardingTopBar'
import { MajorPartyBlockedAlert } from 'app/onboarding/shared/partisanParty'
import ServeOfficePicker from './ServeOfficePicker'
import {
  buildDisabledRanges,
  CALENDAR_END,
  CALENDAR_START,
  formatDisplay,
  overlapsExisting as overlapsExistingRanges,
  TermDatesFields,
  termDateError,
  toApiDate,
  toDate,
  type DisabledRange,
} from './termDates.shared'
import {
  buildBrSuggestionChangedPayload,
  trackServeOnboarding,
  SERVE_ONBOARDING_EVENTS,
  type BrPrefillSnapshot,
} from './serveOnboardingAnalytics'
import {
  resolveServeBranch,
  resolveServeResumeStep,
  shouldSeedInOfficeOnResume,
  getServeProgress,
  isServeMajorParty,
  SERVE_IN_OFFICE_OPTIONS,
  SERVE_PARTY_OPTIONS,
  SERVE_PLEDGE_COMMITMENTS,
  SERVE_STEP_COPY,
  SERVE_WELCOME_VALUE_PROPS,
  type InOfficeStatus,
  type ServeBranch,
  type ServeStepId,
} from './serveOnboardingConfig'

const DEFAULT_OFFICE_LABEL = 'your elected office'

// Screens whose "Viewed" event fires once on view (in a useEffect). The two
// selection screens (`inOffice`, `party`) are deliberately absent: their
// "Viewed" events carry the chosen card title and so fire on Continue instead.
const SERVE_STEP_VIEWED_EVENTS: Partial<Record<ServeStepId, string>> = {
  welcome: SERVE_ONBOARDING_EVENTS.WelcomeViewed,
  office: SERVE_ONBOARDING_EVENTS.OfficeViewed,
  confirm: SERVE_ONBOARDING_EVENTS.ConfirmViewed,
  'term-dates': SERVE_ONBOARDING_EVENTS.TermDatesViewed,
  constituents: SERVE_ONBOARDING_EVENTS.KnowYourConstituentsViewed,
  pledge: SERVE_ONBOARDING_EVENTS.PledgeViewed,
}

export default function ServeOnboardingFlow(): React.JSX.Element {
  const { errorSnackbar } = useSnackbar()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [step, setStep] = useState<ServeStepId>('welcome')
  const [branch, setBranch] = useState<ServeBranch>('net-new')
  // Office/term-dates are reachable as detours from `confirm` in the prefill
  // branch. This flag routes Continue/Back back to `confirm` instead of
  // advancing through the net-new order.
  const [returnToConfirm, setReturnToConfirm] = useState(false)
  const [switchToCampaign, setSwitchToCampaign] = useState(false)

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
  const [orgState, setOrgState] = useState<string | undefined>(undefined)
  const [zip, setZip] = useState<string | undefined>(undefined)
  const [manualEntry, setManualEntry] = useState(false)

  const [termStartDate, setTermStartDate] = useState<Date | undefined>(
    undefined,
  )
  const [termEndDate, setTermEndDate] = useState<Date | undefined>(undefined)

  // Snapshot of the BallotReady-officeholder prefill the lead landed on, frozen
  // at load before the user edits anything. Null = net-new (no officeholder
  // record / personId), which makes the completion-time "BR Suggestion Changed"
  // event report `hadBrPrefill: false`. Used to diff the BR suggestion against
  // the user's final pick so we can measure how inaccurate BallotReady data is.
  const [brPrefill, setBrPrefill] = useState<BrPrefillSnapshot | null>(null)

  useEffect(() => {
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
        const mine = mineRes.ok ? (mineRes.data as ElectedOffice[]) : []
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
            if (org.position?.state) setOrgState(org.position.state)
          }
        }

        setOtherRanges(buildDisabledRanges(mine, eo?.id))

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
        )
        // Seed the UX-only `inOffice` answer whenever we resume past the intro,
        // so backing up to the inOffice step isn't a dead end (its Continue gate
        // needs a selection) and a mis-click on "still campaigning" can't eject
        // a resumed official into the Win flow. Resuming AT welcome/inOffice
        // leaves it unset for the user to choose.
        if (shouldSeedInOfficeOnResume(resumeStep)) setInOffice('in-office')
        setStep(resumeStep)
      } catch (err) {
        reportErrorToSentry(err, { context: 'serveOnboarding.load' })
        setBranch('net-new')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

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
  // BallotReady position ids. The constituents step routes exclusively through
  // orgPositionId so voter-issues / contacts-stats derive the L2 district from
  // the EO org's position pointer (param-less) — the same path the Win flow
  // uses — instead of campaign-scoped resolution an EO has no campaign for.
  const constituentsPositionId = office?.positionId ?? orgPositionId

  const progress = getServeProgress(branch, step)

  // Tracks which BR position id we've already written to the EO org so a
  // back-and-forth through the constituents step doesn't re-PATCH needlessly.
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
      // established before landing on briefings.
      if (electedOfficeId) {
        setCookie(ORG_SLUG_COOKIE, `eo-${electedOfficeId}`)
      }
      window.location.href = `/post-auth-redirect?next=${encodeURIComponent(
        '/dashboard/briefings',
      )}`
    } catch (err) {
      reportErrorToSentry(err, { context: 'serveOnboarding.persist' })
      errorSnackbar('We couldn’t save your office. Please try again.')
      setSaving(false)
    }
  }

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
        const target = branch === 'prefill' ? 'confirm' : 'office'
        void persistAndAdvance(
          {
            targetStep: target,
            eoFields: {
              party: party ?? undefined,
              ...(branch === 'net-new' ? { selfReported: true } : {}),
            },
          },
          () => setStep(target),
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
        const target = returnToConfirm ? 'confirm' : 'term-dates'
        void persistAndAdvance(
          { targetStep: target, office: officePayload() },
          () => {
            setReturnToConfirm(false)
            setStep(target)
          },
          'serveOnboarding.persistOfficeProgress',
        )
        return
      }
      case 'term-dates': {
        const target = returnToConfirm ? 'confirm' : 'constituents'
        void persistAndAdvance(
          {
            targetStep: target,
            eoFields: {
              termStartDate: toApiDate(termStartDate),
              termEndDate: toApiDate(termEndDate),
            },
            // Carry the office pointer forward to the EO org before the
            // constituents step (idempotent if already patched) so its
            // org-derived voter sections can resolve a district. Skipped on the
            // confirm detour, which only edits dates.
            ...(target === 'constituents' ? { office: officePayload() } : {}),
          },
          () => {
            setReturnToConfirm(false)
            setStep(target)
          },
          'serveOnboarding.persistTermDatesProgress',
        )
        return
      }
      case 'confirm':
        void persistAndAdvance(
          { targetStep: 'constituents', office: officePayload() },
          () => setStep('constituents'),
          'serveOnboarding.persistOfficeProgress',
        )
        return
      case 'constituents':
        trackServeOnboarding(
          SERVE_ONBOARDING_EVENTS.KnowYourConstituentsCompleted,
          { branch, electedOfficeId: currentEO?.id },
        )
        void persistAndAdvance(
          { targetStep: 'pledge' },
          () => setStep('pledge'),
          'serveOnboarding.checkpoint.constituents',
        )
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
          setStep('confirm')
        } else {
          setStep('party')
        }
        return
      case 'term-dates':
        if (returnToConfirm) {
          setReturnToConfirm(false)
          setStep('confirm')
        } else {
          setStep('office')
        }
        return
      case 'confirm':
        setStep('party')
        return
      case 'constituents':
        setStep(branch === 'prefill' ? 'confirm' : 'term-dates')
        return
      case 'pledge':
        setStep('constituents')
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
      default:
        return true
    }
  }, [step, inOffice, party, officeIsChosen, datesValid])

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
  const whyThisMatters = SERVE_STEP_COPY[step].whyWeAsk

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
            {step === 'welcome' && <WelcomeStep />}
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
                officeLabel={
                  officeIsChosen ? officeDisplayLabel : 'Add your office'
                }
                officeValid={officeIsChosen}
                termStartDate={termStartDate}
                termEndDate={termEndDate}
                datesValid={datesValid}
                dateError={dateError}
                onChangeOffice={goToOfficeFromConfirm}
                onChangeDates={goToDatesFromConfirm}
              />
            )}
            {step === 'constituents' && (
              <ConstituentsStep
                orgPositionId={constituentsPositionId}
                office={officeDisplayLabel}
                city={office?.city}
                state={office?.state ?? orgState}
              />
            )}
            {step === 'pledge' && <PledgeStep />}
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
            {step === 'pledge' ? 'Agree & Continue' : 'Continue'}
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
    <h1
      className="text-3xl leading-tight font-semibold tracking-tight text-foreground md:text-4xl"
      style={{ fontFamily: 'var(--font-geist)' }}
    >
      {title}
    </h1>
    <p className="mt-4 text-base leading-relaxed text-muted-foreground">
      {description}
    </p>
  </div>
)

const WelcomeStep = (): React.JSX.Element => {
  const copy = SERVE_STEP_COPY.welcome
  return (
    <div>
      <h1
        className="text-4xl leading-tight font-semibold tracking-tight text-foreground md:text-5xl"
        style={{ fontFamily: 'var(--font-geist)' }}
      >
        {copy.title}
      </h1>
      <p className="mt-4 text-base leading-relaxed text-muted-foreground md:text-lg">
        {copy.description}
      </p>

      <div className="mt-10 grid gap-4 text-left sm:grid-cols-2">
        {SERVE_WELCOME_VALUE_PROPS.map((prop) => {
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

      <p className="mt-8 text-sm text-muted-foreground">
        Ready? Hit{' '}
        <span className="font-semibold text-foreground">Continue</span> to get
        started.
      </p>
    </div>
  )
}

const OptionCard = ({
  selected,
  title,
  desc,
  onClick,
}: {
  selected: boolean
  title: string
  desc: string
  onClick: () => void
}): React.JSX.Element => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'w-full rounded-xl border border-base-border bg-card p-5 text-left transition-all hover:border-primary/50',
      selected && 'border-primary bg-primary/5 ring-2 ring-primary/20',
    )}
  >
    <div className="flex items-start gap-3">
      <span
        className={cn(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
          selected
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-muted-foreground/40',
        )}
      >
        {selected && <Check className="h-3 w-3" />}
      </span>
      <div>
        <div className="font-semibold text-foreground">{title}</div>
        <div className="mt-1 text-sm text-muted-foreground">{desc}</div>
      </div>
    </div>
  </button>
)

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
      <div className="mt-8 space-y-3">
        {SERVE_IN_OFFICE_OPTIONS.map((option) => (
          <OptionCard
            key={option.value}
            selected={value === option.value}
            title={option.title}
            desc={option.desc}
            onClick={() => onChange(option.value)}
          />
        ))}
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
      <div className="mt-8 space-y-3">
        {SERVE_PARTY_OPTIONS.map((option) => (
          <OptionCard
            key={option.value}
            selected={value === option.value}
            title={option.title}
            desc={option.desc}
            onClick={() => onChange(option.value)}
          />
        ))}
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
            <input
              id="custom-office"
              className="w-full rounded-md border border-base-border px-3 py-2"
              placeholder="e.g. Springfield City Council, Ward 3"
              value={customOfficeName}
              onChange={(event) => onCustomOfficeNameChange(event.target.value)}
            />
            <button
              type="button"
              className="text-sm font-medium text-primary hover:underline"
              onClick={onDisableManual}
            >
              Search for my office instead
            </button>
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
  invalid,
  onChange,
  changeLabel,
}: {
  label: string
  value: string
  invalid?: boolean
  onChange: () => void
  changeLabel: string
}): React.JSX.Element => (
  <div className="flex items-start justify-between gap-4 py-4">
    <div className="min-w-0">
      <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
      <div
        className={cn(
          'mt-1 font-medium break-words',
          invalid ? 'text-destructive' : 'text-foreground',
        )}
      >
        {value}
      </div>
    </div>
    <button
      type="button"
      onClick={onChange}
      className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-primary hover:underline"
    >
      <Pencil className="h-3.5 w-3.5" />
      {changeLabel}
    </button>
  </div>
)

const ConfirmStep = ({
  officeLabel,
  officeValid,
  termStartDate,
  termEndDate,
  datesValid,
  dateError,
  onChangeOffice,
  onChangeDates,
}: {
  officeLabel: string
  officeValid: boolean
  termStartDate: Date | undefined
  termEndDate: Date | undefined
  datesValid: boolean
  dateError: string | null
  onChangeOffice: () => void
  onChangeDates: () => void
}): React.JSX.Element => {
  const copy = SERVE_STEP_COPY.confirm
  const datesValue =
    termStartDate || termEndDate
      ? `${formatDisplay(termStartDate)} – ${formatDisplay(termEndDate)}`
      : 'Add your term dates'
  return (
    <div>
      <StepHeading title={copy.title} description={copy.description} />

      <Panel className="mt-8 px-6">
        <div className="divide-y divide-base-border">
          <ConfirmRow
            label="Office"
            value={officeLabel}
            invalid={!officeValid}
            onChange={onChangeOffice}
            changeLabel="Change office"
          />
          <ConfirmRow
            label="Term dates"
            value={datesValue}
            invalid={!datesValid}
            onChange={onChangeDates}
            changeLabel="Change dates"
          />
        </div>
      </Panel>

      {!datesValid && dateError && (
        <p className="mt-4 text-sm text-destructive">{dateError}</p>
      )}
    </div>
  )
}

const ConstituentsStep = ({
  orgPositionId,
  office,
  city,
  state,
}: {
  orgPositionId?: string
  office: string
  city?: string
  state?: string
}): React.JSX.Element => {
  const copy = SERVE_STEP_COPY.constituents
  // The local-news endpoint requires a 2-letter state code (the query schema
  // rejects anything else with a 400). Only enable the section when we have a
  // valid code so a missing/full-name state never fires a doomed request.
  const hasValidState = /^[A-Za-z]{2}$/.test(state ?? '')
  return (
    <div>
      <h1
        className="text-3xl leading-tight font-semibold tracking-tight text-foreground md:text-4xl"
        style={{ fontFamily: 'var(--font-geist)' }}
      >
        {copy.title}
      </h1>
      <p className="mt-4 text-base leading-relaxed text-muted-foreground">
        We crunch constituent data and local news to prioritize the most
        important issues for{' '}
        <span className="font-semibold text-foreground">{office}</span>.
      </p>

      <div className="mt-8">
        {/* Reuse the Win flow's demographics step, but override its
            candidate-facing "voter" copy with constituent wording for the
            elected-official audience. Defaults keep the Win flow unchanged. */}
        <VoterDemographicsStep
          orgPositionId={orgPositionId}
          office={office}
          city={city}
          state={state}
          showLocalNewsSources={hasValidState}
          demographicsHeading="Constituent Demographics"
          totalLabel="Total Constituents"
          ageDistributionDescription="We'll help you tailor your outreach mix to each age group — leaning into SMS and social for younger constituents, and prioritizing mail and door-knocks for older ones."
          topIssuesHeading="Top issues for your constituents"
          topIssuesDescription="The issues constituents in your district care about most right now."
        />
      </div>
    </div>
  )
}

const PledgeStep = (): React.JSX.Element => {
  const copy = SERVE_STEP_COPY.pledge
  return (
    <div>
      <StepHeading title={copy.title} description={copy.description} />

      <Panel className="mt-8 p-6 sm:p-8">
        <h2
          className="mb-6 text-xl font-semibold text-foreground"
          style={{ fontFamily: 'var(--font-geist)' }}
        >
          I pledge to be...
        </h2>
        <div className="space-y-6">
          {SERVE_PLEDGE_COMMITMENTS.map((commitment) => {
            const Icon = commitment.icon
            return (
              <div key={commitment.title}>
                <div className="flex items-center gap-2">
                  <Icon className="h-5 w-5 text-foreground" />
                  <h3
                    className="text-lg font-semibold text-foreground"
                    style={{ fontFamily: 'var(--font-geist)' }}
                  >
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
        <h1
          className="text-3xl leading-tight font-semibold tracking-tight text-foreground md:text-4xl"
          style={{ fontFamily: 'var(--font-geist)' }}
        >
          Let&apos;s switch you to campaign mode
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          The elected-official experience is built for sitting officials. Since
          you&apos;re still campaigning, we&apos;ll set you up with a winning
          campaign plan instead.
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
