'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Label } from '@styleguide'
import { GoodPartyOrgLogoWordmark } from '@styleguide'
import { cn } from '@styleguide/lib/utils'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Compass,
  LoaderCircle,
  Pencil,
} from 'lucide-react'
import { addDays, format, parse } from 'date-fns'
import { clientRequest } from 'gpApi/typed-request'
import type { ElectedOffice, Organization } from 'gpApi/api-endpoints'
import { setCookie } from 'helpers/cookieHelper'
import { ORG_SLUG_COOKIE } from '@shared/organizations/constants'
import { reportErrorToSentry } from '@shared/sentry'
import { useSnackbar } from 'helpers/useSnackbar'
import type { SelectedOffice } from 'app/onboarding/components/onboardingTypes'
import { VoterDemographicsStep } from 'app/onboarding/components/VoterDemographicsStep'
import DateInputCalendar from '@shared/inputs/DateInputCalendar'
import ServeOfficePicker from './ServeOfficePicker'
import {
  trackServeOnboarding,
  SERVE_ONBOARDING_EVENTS,
} from './serveOnboardingAnalytics'
import {
  getServeProgress,
  SERVE_IN_OFFICE_OPTIONS,
  SERVE_PARTY_OPTIONS,
  SERVE_PLEDGE_COMMITMENTS,
  SERVE_STEP_COPY,
  SERVE_WELCOME_VALUE_PROPS,
  type InOfficeStatus,
  type ServeBranch,
  type ServeStepId,
} from './serveOnboardingConfig'

type DisabledRange = { from: Date; to: Date }

const FAR_FUTURE = new Date(3000, 0, 1)
const FAR_PAST = new Date(1900, 0, 1)

// Term dates legitimately reach into the future (a term end, or a soon-to-be
// sworn-in official's start), so the calendar's year dropdown must span well
// past today rather than capping at the current year.
const CALENDAR_START = new Date(2000, 0, 1)
const CALENDAR_END = new Date(new Date().getFullYear() + 20, 11, 31)

const DEFAULT_OFFICE_LABEL = 'your elected office'

const toDate = (value: string | null | undefined): Date | undefined => {
  if (!value) return undefined
  const parsed = parse(value, 'yyyy-MM-dd', new Date())
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

const toApiDate = (value: Date | undefined): string | null =>
  value ? format(value, 'yyyy-MM-dd') : null

const formatDisplay = (date: Date | undefined): string =>
  date ? format(date, 'MMMM d, yyyy') : 'Not set'

const buildDisabledRanges = (
  offices: ElectedOffice[],
  excludeId: string | undefined,
): DisabledRange[] =>
  offices
    .filter((office) => office.id !== excludeId)
    .filter((office) => office.termStartDate || office.termEndDate)
    .map((office) => {
      const end = toDate(office.termEndDate)
      return {
        from: toDate(office.termStartDate) ?? FAR_PAST,
        // Store the EXCLUSIVE end (termEndDate is the successor's start day) so
        // the overlap check matches the API's half-open dateRangesOverlap. The
        // calendar's inclusive disabled matcher decrements this by a day on its
        // own, so the boundary day stays selectable for a consecutive term.
        to: end ?? FAR_FUTURE,
      }
    })

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
  const [otherRanges, setOtherRanges] = useState<DisabledRange[]>([])

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

        let officePrefilled = false

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
              officePrefilled = true
            }
            if (org.position?.brPositionId) {
              setOrgPositionId(org.position.brPositionId)
              officePrefilled = true
            }
            if (org.position?.state) setOrgState(org.position.state)
          }
        }

        setOtherRanges(buildDisabledRanges(mine, eo?.id))

        trackServeOnboarding(SERVE_ONBOARDING_EVENTS.Activated, {
          electedOfficeId: eo?.id,
        })

        const termPrefilled = !!(eo?.termStartDate || eo?.termEndDate)
        setBranch(officePrefilled || termPrefilled ? 'prefill' : 'net-new')
      } catch (err) {
        reportErrorToSentry(err, { context: 'serveOnboarding.load' })
        setBranch('net-new')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const disabledMatchers = useMemo(
    // range.to is the exclusive term end; the day-picker's disabled matcher is
    // inclusive, so decrement by a day to leave the boundary day selectable for
    // a consecutive term (matching the half-open API semantics).
    () =>
      otherRanges.map((range) => ({
        from: range.from,
        to: addDays(range.to, -1),
      })),
    [otherRanges],
  )

  const endDisabledMatchers = useMemo(() => {
    if (!termStartDate) return disabledMatchers
    return [...disabledMatchers, { before: addDays(termStartDate, 1) }]
  }, [disabledMatchers, termStartDate])

  const officeIsChosen = Boolean(
    office?.positionId ||
    customOfficeName.trim() ||
    // In the prefill branch the office may already be set on the EO org and
    // never re-picked in this session.
    (branch === 'prefill' && officeLabel !== DEFAULT_OFFICE_LABEL),
  )

  const overlapsExisting = useMemo(() => {
    if (!termStartDate && !termEndDate) return false
    const start = termStartDate ?? FAR_PAST
    const end = termEndDate ?? FAR_FUTURE
    // Terms are half-open [start, end): the end date is the exclusive boundary
    // where the successor takes over, so a new term that starts exactly on a
    // prior term's end day does not overlap — must match the API's
    // dateRangesOverlap (< not <=) or the UI blocks a term the server accepts.
    return otherRanges.some((range) => start < range.to && range.from < end)
  }, [termStartDate, termEndDate, otherRanges])

  const datesValid =
    !!termStartDate &&
    !!termEndDate &&
    termStartDate < termEndDate &&
    !overlapsExisting

  const dateError = useMemo(() => {
    if (!termStartDate || !termEndDate) {
      return 'Enter both your term start and end dates to continue.'
    }
    if (termStartDate >= termEndDate) {
      return 'Your term end date must be after your start date.'
    }
    if (overlapsExisting) {
      return 'These dates overlap a term you already hold. Adjust them so your offices don’t overlap.'
    }
    return null
  }, [termStartDate, termEndDate, overlapsExisting])

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

  // Point the EO org at the selected position BEFORE the constituents step so
  // the org-derived voter-issues / contacts-stats endpoints have a district to
  // resolve. persist() re-writes the same pointer at the end; this just brings
  // it forward and is idempotent.
  const ensureOrgOfficeForConstituents = async (): Promise<void> => {
    const positionId = office?.positionId
    if (!currentEO || !positionId) return
    if (patchedOfficeRef.current === positionId) return
    await clientRequest('PATCH /v1/organizations/:slug', {
      slug: `eo-${currentEO.id}`,
      ballotReadyPositionId: positionId,
      customPositionName: null,
    })
    patchedOfficeRef.current = positionId
  }

  const goToConstituents = async (): Promise<void> => {
    setSaving(true)
    try {
      await ensureOrgOfficeForConstituents()
    } catch (err) {
      // Degrade gracefully: the constituents step still renders, the
      // org-derived sections just stay empty if the pointer didn't land.
      reportErrorToSentry(err, {
        context: 'serveOnboarding.ensureOrgOfficeForConstituents',
      })
    } finally {
      setSaving(false)
      setStep('constituents')
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
      ...(office?.positionId
        ? { ballotReadyPositionId: office.positionId }
        : {}),
      ...(customOfficeName.trim()
        ? { customPositionName: customOfficeName.trim() }
        : {}),
    }

    try {
      let electedOfficeId = currentEO?.id

      if (currentEO) {
        if (office?.positionId || customOfficeName.trim()) {
          await clientRequest('PATCH /v1/organizations/:slug', {
            slug: `eo-${currentEO.id}`,
            ballotReadyPositionId: office?.positionId ?? null,
            customPositionName: customOfficeName.trim() || null,
          })
        }
        await clientRequest('PUT /v1/elected-office/:id', {
          id: currentEO.id,
          ...body,
        })
      } else {
        const created = await clientRequest('POST /v1/elected-office', body)
        electedOfficeId = (created.data as ElectedOffice).id
      }

      trackServeOnboarding(SERVE_ONBOARDING_EVENTS.Completed, {
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

  const goToOfficeFromConfirm = () => {
    trackServeOnboarding(SERVE_ONBOARDING_EVENTS.SuggestionChanged, {
      electedOfficeId: currentEO?.id,
    })
    setReturnToConfirm(true)
    setManualEntry(false)
    setStep('office')
  }

  const goToDatesFromConfirm = () => {
    trackServeOnboarding(SERVE_ONBOARDING_EVENTS.SuggestionChanged, {
      electedOfficeId: currentEO?.id,
    })
    setReturnToConfirm(true)
    setStep('term-dates')
  }

  const handleContinue = () => {
    switch (step) {
      case 'welcome':
        setStep('inOffice')
        return
      case 'inOffice':
        if (inOffice === 'campaigning') {
          setSwitchToCampaign(true)
          return
        }
        setStep('party')
        return
      case 'party':
        setStep(branch === 'prefill' ? 'confirm' : 'office')
        return
      case 'office':
        setStep(returnToConfirm ? 'confirm' : 'term-dates')
        setReturnToConfirm(false)
        return
      case 'term-dates':
        if (returnToConfirm) {
          setStep('confirm')
        } else {
          void goToConstituents()
        }
        setReturnToConfirm(false)
        return
      case 'confirm':
        void goToConstituents()
        return
      case 'constituents':
        setStep('pledge')
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
        return party !== null
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
      <div className="min-h-screen w-full bg-background pb-12">
        <FlowHeader />
        <SwitchToCampaignStep onBack={() => setSwitchToCampaign(false)} />
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full bg-background pb-24">
      <FlowHeader />

      <div className="relative mx-auto max-w-5xl px-6 pt-8">
        <div className="pointer-events-none absolute inset-x-6 top-0 flex h-8 items-center justify-end text-xs font-medium text-muted-foreground">
          Step {progress.current} of {progress.total}
        </div>
        <div className="flex w-full items-center gap-1.5">
          {Array.from({ length: progress.total }).map((_, i) => (
            <div
              key={i}
              className={cn(
                'h-1.5 flex-1 rounded-full transition-colors',
                progress.current - 1 >= i ? 'bg-primary' : 'bg-muted',
              )}
            />
          ))}
        </div>
      </div>

      {step === 'welcome' && <WelcomeStep />}
      {step === 'inOffice' && (
        <InOfficeStep value={inOffice} onChange={setInOffice} />
      )}
      {step === 'party' && <PartyStep value={party} onChange={setParty} />}
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
          startDisabled={disabledMatchers}
          endDisabled={endDisabledMatchers}
          calendarStart={CALENDAR_START}
          calendarEnd={CALENDAR_END}
          error={dateError}
        />
      )}
      {step === 'confirm' && (
        <ConfirmStep
          officeLabel={officeIsChosen ? officeDisplayLabel : 'Add your office'}
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

      <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-base-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div
          className={cn(
            'mx-auto flex w-full max-w-5xl items-center gap-4 px-6 py-4',
            step === 'welcome' ? 'justify-end' : 'justify-between',
          )}
        >
          {step !== 'welcome' && (
            <Button
              variant="ghost"
              onClick={handleBack}
              icon={<ArrowLeft className="h-4 w-4" />}
              disabled={saving}
            >
              Back
            </Button>
          )}
          <Button
            type="button"
            size="large"
            onClick={handleContinue}
            disabled={!canContinue || saving}
            loading={saving}
            icon={<ArrowRight className="h-4 w-4" />}
            iconPosition="right"
            className="px-8"
          >
            {step === 'pledge' ? 'Agree & Continue' : 'Continue'}
          </Button>
        </div>
      </footer>
    </div>
  )
}

const FlowHeader = (): React.JSX.Element => (
  <header className="flex items-center border-b border-base-border px-6 py-4">
    <GoodPartyOrgLogoWordmark size="small" textVariant="dark" />
  </header>
)

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

const WhyWeAsk = ({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element => (
  <Panel className="mt-6 p-4">
    <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
      <Compass className="h-3.5 w-3.5" /> Why we ask
    </div>
    <p className="mt-2 text-sm leading-relaxed text-foreground">{children}</p>
  </Panel>
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
    <main className="mx-auto max-w-3xl px-6 pt-12 pb-8 text-center">
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
    </main>
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
    <main className="mx-auto max-w-3xl px-6 pt-12 pb-8">
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
      {copy.whyWeAsk && <WhyWeAsk>{copy.whyWeAsk}</WhyWeAsk>}
    </main>
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
    <main className="mx-auto max-w-3xl px-6 pt-12 pb-8">
      <StepHeading title={copy.title} description={copy.description} />
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
      {copy.whyWeAsk && <WhyWeAsk>{copy.whyWeAsk}</WhyWeAsk>}
    </main>
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
    <main className="mx-auto max-w-3xl px-6 pt-12 pb-8">
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

      {copy.whyWeAsk && <WhyWeAsk>{copy.whyWeAsk}</WhyWeAsk>}
    </main>
  )
}

const TermDatesStep = ({
  termStartDate,
  termEndDate,
  onStartChange,
  onEndChange,
  startDisabled,
  endDisabled,
  calendarStart,
  calendarEnd,
  error,
}: {
  termStartDate: Date | undefined
  termEndDate: Date | undefined
  onStartChange: (date: Date | undefined) => void
  onEndChange: (date: Date | undefined) => void
  startDisabled: { from: Date; to: Date }[]
  endDisabled: ({ from: Date; to: Date } | { before: Date })[]
  calendarStart: Date
  calendarEnd: Date
  error: string | null
}): React.JSX.Element => {
  const copy = SERVE_STEP_COPY['term-dates']
  return (
    <main className="mx-auto max-w-3xl px-6 pt-12 pb-8">
      <StepHeading title={copy.title} description={copy.description} />

      <Panel className="mt-8 p-4 sm:p-6">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Term start date</Label>
            <DateInputCalendar
              value={termStartDate}
              onChange={onStartChange}
              showTextInput
              label="Term start"
              startMonth={calendarStart}
              endMonth={calendarEnd}
              disabled={startDisabled}
            />
          </div>
          <div className="space-y-2">
            <Label>Term end date</Label>
            <DateInputCalendar
              value={termEndDate}
              onChange={onEndChange}
              showTextInput
              label="Term end"
              startMonth={calendarStart}
              endMonth={calendarEnd}
              disabled={endDisabled}
            />
          </div>
        </div>
      </Panel>

      {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

      {copy.whyWeAsk && <WhyWeAsk>{copy.whyWeAsk}</WhyWeAsk>}
    </main>
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
    <main className="mx-auto max-w-3xl px-6 pt-12 pb-8">
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

      {copy.whyWeAsk && <WhyWeAsk>{copy.whyWeAsk}</WhyWeAsk>}
    </main>
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
    <main className="mx-auto max-w-3xl px-6 pt-12 pb-8">
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
        <VoterDemographicsStep
          orgPositionId={orgPositionId}
          office={office}
          city={city}
          state={state}
          showLocalNewsSources={hasValidState}
        />
      </div>

      {copy.whyWeAsk && <WhyWeAsk>{copy.whyWeAsk}</WhyWeAsk>}
    </main>
  )
}

const PledgeStep = (): React.JSX.Element => {
  const copy = SERVE_STEP_COPY.pledge
  return (
    <main className="mx-auto max-w-3xl px-6 pt-12 pb-8">
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
    </main>
  )
}

const SwitchToCampaignStep = ({
  onBack,
}: {
  onBack: () => void
}): React.JSX.Element => {
  const handleSwitch = () => {
    // "Still campaigning" belongs in the candidate/Win onboarding, not serve.
    // Hand off to the Win flow's entry point.
    window.location.href = '/onboarding/office-selection'
  }
  return (
    <>
      <main className="mx-auto max-w-3xl px-6 pt-12 pb-28">
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

      <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-base-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <Button
            variant="ghost"
            onClick={onBack}
            icon={<ArrowLeft className="h-4 w-4" />}
          >
            Back
          </Button>
          <Button
            size="large"
            onClick={handleSwitch}
            icon={<ArrowRight className="h-4 w-4" />}
            iconPosition="right"
            className="px-8"
          >
            Switch to Campaign
          </Button>
        </div>
      </footer>
    </>
  )
}
