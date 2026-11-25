import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { startOfDay } from 'date-fns'
import { Button, Spinner } from '@styleguide'
import {
  Alert,
  AlertAction,
  AlertDescription,
} from '@styleguide/components/ui/alert'
import { InfoIcon } from '@styleguide/components/ui/icons'
import { MANAGED_PANEL_FIRST_SEND_MAX_DAYS } from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import type {
  ElectedOffice,
  MyElectedOffice,
  Organization,
} from 'gpApi/api-endpoints'
import { setCookie } from 'helpers/cookieHelper'
import { useSnackbar } from 'helpers/useSnackbar'
import { ORG_SLUG_COOKIE } from '@shared/organizations/constants'
import { useUser } from '@shared/hooks/useUser'
import { useIsImpersonating } from '@shared/hooks/useIsImpersonating'
import { reportClientError } from '@shared/observability/reportClientError'
import { dismissElectionResult } from 'app/dashboard/election-result/dismissal'
import { servePlaceOf } from 'app/dashboard/contacts/citizens-panel/managedPanelCopy'
import { composeManagedInvite } from 'app/dashboard/outreach/v2/sms/smsCompose.util'
import { onboardingDistrictStatsQueryOptions } from 'app/onboarding/components/VoterDemographicsStep'
import { grammarizeOfficeName } from 'app/polls/onboarding/utils/grammarizeOfficeName'
import {
  SERVE_ONBOARDING_EVENTS,
  trackServeOnboarding,
  WARM_WELCOME_EVENTS,
} from '../serveOnboardingAnalytics'
import { campaignParty } from '../winParty'
import { BriefingStep } from './BriefingStep'
import {
  firstMeetingFrom,
  parseDay,
  toDayString,
  toTimeString,
  type CalendarId,
  type FirstMeeting,
} from './firstMeeting'
import { MeetingStep, type MeetingAnswer } from './MeetingStep'
import { readyWeekLabel, sendDayLong } from './panelDays'
import { PrioritiesStep } from './PrioritiesStep'
import { RecapStep, type RecapRow } from './RecapStep'
import { prefersReducedMotion } from './Reveal'
import {
  ResidentsStep,
  type PanelOffer,
  type PanelSetup,
} from './ResidentsStep'
import { WarmWelcomeShell } from './WarmWelcomeShell'
import { WonStep } from './WonStep'
import {
  inviteChunk,
  isWarmWelcomeOffice,
  officeWords,
  resumeWarmWelcomeStep,
  WARM_WELCOME_COPY,
  WARM_WELCOME_STEPS,
  warmWelcomeSteps,
  type WarmWelcomeStepId,
} from './warmWelcomeConfig'
import './warmWelcome.css'

// The office the warm welcome opens for, with what its screens name.
export interface WarmWelcomeOffice {
  office: ElectedOffice
  party: string
  // The place the office serves ("Northampton"), when its district names one.
  place: string | null
  // The office as the product names it ("Northampton City Council").
  positionName: string | null
  positionId: string | undefined
}

// Null when the user has no office the warm welcome is for, which sends
// them to the stepper onboarding. The office is picked the way that
// onboarding picks it, so both open the same one.
export const warmWelcomeOfficeQueryOptions = queryOptions({
  queryKey: ['serve-warm-welcome-office'] as const,
  staleTime: Infinity,
  retry: false,
  queryFn: async (): Promise<WarmWelcomeOffice | null> => {
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
    const current = currentRes.ok ? (currentRes.data as ElectedOffice) : null
    const mine = mineRes.ok ? (mineRes.data as MyElectedOffice[]) : []
    const onboardable = mine.filter((office) => !office.prepared)
    const office =
      current ??
      onboardable.find((candidate) => !candidate.onboardingCompletedAt) ??
      onboardable[0] ??
      null
    if (!office) return null
    const party = office.party ?? (await campaignParty(office)) ?? null
    if (party === null || !isWarmWelcomeOffice(office, party)) return null

    setCookie(ORG_SLUG_COOKIE, `eo-${office.id}`)
    const orgRes = await clientRequest(
      'GET /v1/organizations/:slug',
      { slug: `eo-${office.id}` },
      { ignoreResponseError: true },
    )
    const org = orgRes.ok ? (orgRes.data as Organization) : null
    return {
      office,
      party,
      place: servePlaceOf(org?.district?.l2Name),
      positionName: org?.positionName ?? null,
      positionId: org?.position?.brPositionId ?? undefined,
    }
  },
})

const Loading = (): React.JSX.Element => (
  <div className="flex min-h-[60vh] items-center justify-center">
    <Spinner />
  </div>
)

// What the first screen and the breadcrumb need is worth a short wait, not
// a long one. Anything slower joins the flow when it lands.
const FIRST_PAINT_WAIT_MS = 4000
// The search for local issues takes 25 to 55 seconds; it is asked about
// this often, for this long.
const FOCUS_POLL_MS = 4000
const FOCUS_POLL_LIMIT_MS = 120_000
// gp-api counts the limit from the Pacific calendar day, which can be a day
// behind this browser's, so the last day it allows is left off here.
const PANEL_MAX_DAYS_OUT = MANAGED_PANEL_FIRST_SEND_MAX_DAYS - 1
// Invites go out at 11 am in the district's own zone.
const PANEL_SEND_HOUR = 11
// The stage goes dark over this long before the page changes.
const EXIT_MS = 1300
// The words the official agrees to by pressing "Set it up" under the invite
// they just read. gp-api stores it with the approval.
const PANEL_CONSENT_VERSION = 'warm-welcome-set-it-up-2026-11-25'

// The invite as gp-api sends it: the greeting with the resident's own first
// name, the part the official can change, the promise about their replies,
// then the two locked lines.
const composeInvite = (chunk: string): string =>
  composeManagedInvite(
    `${WARM_WELCOME_COPY.residents.greeting('{{first_name}}')}${chunk.trim()}\n\n${WARM_WELCOME_COPY.residents.pledge}`,
  )

const WarmWelcomeFlow = ({
  data,
}: {
  data: WarmWelcomeOffice
}): React.JSX.Element => {
  const { office, party, place, positionName, positionId } = data
  const router = useRouter()
  const { errorSnackbar } = useSnackbar()
  const isImpersonating = useIsImpersonating()
  const [user] = useUser()
  const firstName = user?.firstName?.trim() || null
  const fullName =
    [user?.firstName, user?.lastName]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(' ') || null
  const officeTitle = positionName ? grammarizeOfficeName(positionName) : null
  const words = useMemo(
    () => officeWords(positionName, officeTitle),
    [positionName, officeTitle],
  )

  const meetingsQuery = useQuery({
    queryKey: ['serve-warm-welcome-meetings', office.id] as const,
    staleTime: Infinity,
    retry: false,
    queryFn: () =>
      clientRequest('GET /v1/meetings', {}).then((res) => res.data),
  })
  const statsQuery = useQuery(
    onboardingDistrictStatsQueryOptions({ orgPositionId: positionId }),
  )
  // Resident comments for the map. None, or a failed read, and the map is
  // left out.
  const voicesQuery = useQuery({
    queryKey: ['serve-warm-welcome-voices', office.id] as const,
    staleTime: Infinity,
    retry: false,
    queryFn: () =>
      clientRequest('GET /v1/resident-voices', {}).then((res) => res.data),
  })
  // The Civic Panel: the district's goal, and whether one is already being
  // built. An office that cannot have one is not offered it.
  const panelQuery = useQuery({
    queryKey: ['serve-warm-welcome-panel', office.id] as const,
    staleTime: Infinity,
    retry: false,
    queryFn: async () => {
      const [summary, managed] = await Promise.all([
        clientRequest('GET /v1/contacts/civic-panel', {}),
        clientRequest('GET /v1/contacts/civic-panel/managed', {}),
      ])
      return { goal: summary.data.progress.goal, panel: managed.data.panel }
    },
  })

  // The issues to pick a focus from. The search for local ones starts with
  // the flow, so it is done by the time the official gets there.
  const [focusStartedAt] = useState(() => Date.now())
  const searchStarted = useRef(false)
  useEffect(() => {
    if (searchStarted.current) return
    searchStarted.current = true
    const post = () => clientRequest('POST /v1/community-issues/onboarding', {})
    post()
      .catch(post)
      .catch((err: Error) =>
        reportClientError(err, { context: 'serveWarmWelcome.issueSearch' }),
      )
  }, [])
  const focusQuery = useQuery({
    queryKey: ['serve-warm-welcome-focus', office.id] as const,
    retry: false,
    queryFn: () =>
      clientRequest('GET /v1/priorities/onboarding/focus', {}).then(
        (res) => res.data,
      ),
    refetchInterval: (query) =>
      query.state.data?.searchPending &&
      query.state.data.options.length === 0 &&
      Date.now() - focusStartedAt < FOCUS_POLL_LIMIT_MS
        ? FOCUS_POLL_MS
        : false,
  })

  const [today] = useState(() => startOfDay(new Date()))
  const found = useMemo(
    () =>
      firstMeetingFrom(
        meetingsQuery.data?.meetings ?? [],
        parseDay(office.termStartDate),
        today,
      ),
    [meetingsQuery.data, office.termStartDate, today],
  )
  const [answer, setAnswer] = useState<MeetingAnswer | null>(null)
  const meeting: FirstMeeting | null = answer ? answer.meeting : found
  // Their first day in office: the term on file, else the first meeting
  // they confirmed here.
  const swornIn =
    parseDay(office.termStartDate) ??
    (answer && answer.kind !== 'unknown' ? answer.meeting.day : null)

  const voices = voicesQuery.data?.voices ?? []
  const syntheticCount = voicesQuery.data?.syntheticCount ?? 0
  const offer: PanelOffer | null = panelQuery.data
    ? {
        goal: panelQuery.data.goal,
        sendHour: PANEL_SEND_HOUR,
        maxDaysOut: PANEL_MAX_DAYS_OUT,
      }
    : null
  const builtPanel = panelQuery.data?.panel
  const [setUpDay, setSetUpDay] = useState<Date | null>(null)
  const panelDay =
    setUpDay ??
    (builtPanel && builtPanel.status !== 'stopped'
      ? parseDay(builtPanel.progress.firstSendDate)
      : null)

  const focus = focusQuery.data
  const cards = focus?.options ?? []
  const focusSearching =
    cards.length === 0 &&
    (focusQuery.isLoading ||
      (focus?.searchPending === true &&
        Date.now() - focusStartedAt < FOCUS_POLL_LIMIT_MS))
  const [pickedKey, setPickedKey] = useState<string | null>(null)
  const [focusLine, setFocusLine] = useState<string | null>(null)
  const picked = pickedKey ?? focus?.saved?.focusKey ?? null

  const steps = warmWelcomeSteps({
    foundMeeting: found !== null,
    meetingKnown: meeting !== null,
    residents: voices.length > 0 || offer !== null,
    priorities: cards.length > 0 || focusSearching,
  })

  const [waitOver, setWaitOver] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setWaitOver(true), FIRST_PAINT_WAIT_MS)
    return () => clearTimeout(timer)
  }, [])

  // Chosen once, when the data the first screen needs is in: where to
  // resume, and which numbers the first step has to count to.
  const [start, setStart] = useState<{
    population: number | null
    votes: number | null
  } | null>(null)
  const [step, setStep] = useState<WarmWelcomeStepId | null>(null)
  const settled =
    !statsQuery.isLoading &&
    !voicesQuery.isLoading &&
    !panelQuery.isLoading &&
    !focusQuery.isLoading
  const ready = !meetingsQuery.isLoading && (settled || waitOver)
  useEffect(() => {
    if (!ready || start) return
    setStart({
      population: statsQuery.data?.districtPopulation ?? null,
      votes: office.votesReceived ?? null,
    })
    setStep(resumeWarmWelcomeStep(office.onboardingStep, steps))
  }, [ready, start, office, steps, statsQuery.data])

  // A step that loses what it shows (the search found nothing) hands over
  // to the next one that is still in the flow.
  useEffect(() => {
    if (!step || steps.includes(step)) return
    const later = WARM_WELCOME_STEPS.slice(WARM_WELCOME_STEPS.indexOf(step))
    setStep(later.find((id) => steps.includes(id)) ?? 'warm-recap')
  }, [step, steps])

  useEffect(() => {
    if (!step) return
    trackServeOnboarding(WARM_WELCOME_EVENTS[step].viewed, {
      electedOfficeId: office.id,
    })
  }, [step, office.id])

  const [saving, setSaving] = useState(false)
  const [exiting, setExiting] = useState(false)
  const [residentsAt, setResidentsAt] = useState<'see' | 'ask'>('see')

  const checkpoint = (next: WarmWelcomeStepId): void => {
    clientRequest('PUT /v1/elected-office/:id', {
      id: office.id,
      onboardingStep: next,
    }).catch((err: Error) =>
      reportClientError(err, { context: 'serveWarmWelcome.checkpoint' }),
    )
  }

  const advance = (
    from: WarmWelcomeStepId,
    properties: Record<string, string | number | boolean | null> = {},
  ): void => {
    if (step !== from) return
    const next = steps[steps.indexOf(from) + 1]
    if (!next) return
    trackServeOnboarding(WARM_WELCOME_EVENTS[from].completed, {
      electedOfficeId: office.id,
      ...properties,
    })
    setStep(next)
    // The checkpoint is saved behind the move, so it never holds the motion.
    checkpoint(next)
  }

  // A date the official corrects is saved, so their Meeting Briefing follows
  // it. Confirming the date we found, or not knowing yet, clears one saved
  // earlier.
  const [stated, setStated] = useState(false)
  const answerMeeting = async (next: MeetingAnswer): Promise<boolean> => {
    setSaving(true)
    try {
      if (next.kind === 'corrected') {
        await clientRequest('PUT /v1/meetings/first-meeting', {
          meetingDate: toDayString(next.meeting.day),
          meetingTime: toTimeString(next.meeting.startMinutes),
        })
        setStated(true)
      } else if (stated) {
        await clientRequest('DELETE /v1/meetings/first-meeting', {})
        setStated(false)
      }
      setAnswer(next)
      return true
    } catch (err) {
      reportClientError(err, { context: 'serveWarmWelcome.firstMeeting' })
      errorSnackbar(WARM_WELCOME_COPY.meeting.saveFailed)
      return false
    } finally {
      setSaving(false)
    }
  }

  const remind = (): void => {
    clientRequest('PUT /v1/elected-office/:id', {
      id: office.id,
      briefingTextReminder: true,
    }).catch((err: Error) =>
      reportClientError(err, { context: 'serveWarmWelcome.reminder' }),
    )
  }

  const setUpPanel = async (setup: PanelSetup): Promise<boolean> => {
    setSaving(true)
    try {
      await clientRequest('POST /v1/contacts/civic-panel/managed', {
        inviteMessage: composeInvite(setup.chunk),
        consentVersion: PANEL_CONSENT_VERSION,
        firstSendDate: toDayString(setup.firstSend),
      })
      setSetUpDay(setup.firstSend)
      return true
    } catch (err) {
      reportClientError(err, { context: 'serveWarmWelcome.civicPanel' })
      errorSnackbar(WARM_WELCOME_COPY.residents.setUpFailed)
      return false
    } finally {
      setSaving(false)
    }
  }

  const saveFocus = async (): Promise<void> => {
    const card = cards.find((each) => each.key === picked)
    if (!card || saving) return
    setSaving(true)
    try {
      const { data: saved } = await clientRequest(
        'PUT /v1/priorities/onboarding/focus',
        { shownKeys: cards.map((each) => each.key), focusKey: card.key },
      )
      setFocusLine(saved.recapLine)
      advance('warm-priorities', {
        shown: cards.length,
        kind: focus?.kind ?? null,
        focusKind: card.kind,
        residentInterest: card.residentInterest,
        firstWin: card.firstWin,
      })
    } catch (err) {
      reportClientError(err, { context: 'serveWarmWelcome.focus' })
      errorSnackbar(WARM_WELCOME_COPY.priorities.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  // Done is the completion save: it makes the office live, which starts
  // Meeting Briefings and the full community issues run. A term that is not
  // on file yet starts on the first meeting they confirmed here; gp-api
  // works out its end. No pledge was shown, so pledgedAt is left as it is.
  const finish = async (): Promise<void> => {
    setSaving(true)
    try {
      await clientRequest('PUT /v1/elected-office/:id', {
        id: office.id,
        party,
        onboardingCompletedAt: new Date().toISOString(),
        onboardingStep: 'warm-recap',
        ...(!office.termStartDate && swornIn
          ? { termStartDate: toDayString(swornIn) }
          : {}),
      })
      await trackServeOnboarding(WARM_WELCOME_EVENTS['warm-recap'].completed, {
        electedOfficeId: office.id,
      })
      await trackServeOnboarding(SERVE_ONBOARDING_EVENTS.Completed, {
        electedOfficeId: office.id,
        flow: 'warm_welcome',
      })
      setCookie(ORG_SLUG_COOKIE, `eo-${office.id}`)
      const handoff = new URLSearchParams({
        next: '/dashboard/chief-of-staff',
        org: `eo-${office.id}`,
      })
      const leave = (): void => {
        window.location.href = `/post-auth-redirect?${handoff.toString()}`
      }
      if (prefersReducedMotion()) {
        leave()
        return
      }
      setExiting(true)
      setTimeout(leave, EXIT_MS)
    } catch (err) {
      reportClientError(err, { context: 'serveWarmWelcome.finish' })
      errorSnackbar(WARM_WELCOME_COPY.recap.saveFailed)
      setSaving(false)
    }
  }

  if (!start || !step) return <Loading />

  const notice: ReactNode = isImpersonating ? (
    <Alert variant="info" icon={<InfoIcon />}>
      <AlertDescription>
        Impersonation mode: leave this without finishing it. It won&apos;t
        change the account, and they&apos;ll still see it next time.
      </AlertDescription>
      <AlertAction>
        <Button
          type="button"
          variant="alertFilled"
          size="small"
          onClick={() => {
            dismissElectionResult()
            router.push('/dashboard')
          }}
        >
          Dismiss
        </Button>
      </AlertAction>
    </Alert>
  ) : null

  const copy = WARM_WELCOME_COPY.recap
  const pickedCard = cards.find((each) => each.key === picked)
  const recapRows: RecapRow[] = [
    meeting
      ? { key: 'meeting', icon: 'file', line: copy.briefing(meeting) }
      : { key: 'meeting', icon: 'calendar', line: copy.noMeeting },
    pickedCard
      ? {
          key: 'focus',
          icon: 'flag',
          line: copy.focus(
            focusLine ?? pickedCard.recapLine ?? pickedCard.title,
          ),
        }
      : { key: 'focus', icon: 'spark', line: copy.serve },
    ...(offer
      ? [
          panelDay
            ? ({
                key: 'panel',
                icon: 'ear',
                line: copy.panelOn(
                  sendDayLong(panelDay),
                  readyWeekLabel(panelDay),
                ),
              } satisfies RecapRow)
            : ({
                key: 'panel',
                icon: 'ear',
                line: copy.panelAsk(offer.goal),
                onOpen: () => {
                  setResidentsAt('ask')
                  setStep('warm-residents')
                },
              } satisfies RecapRow),
        ]
      : []),
  ]

  return (
    <WarmWelcomeShell
      steps={steps}
      step={step}
      onGoTo={(id) => {
        if (id === 'warm-residents') setResidentsAt('see')
        setStep(id)
      }}
      notice={notice}
      exiting={exiting}
    >
      {(id) => {
        if (id === 'warm-won') {
          return (
            <WonStep
              firstName={firstName}
              place={place}
              votes={start.votes}
              population={start.population}
              onNext={() =>
                advance('warm-won', {
                  hasPopulation: start.population !== null,
                  hasVotes: start.votes !== null,
                })
              }
            />
          )
        }
        if (id === 'warm-meeting' && found) {
          return (
            <MeetingStep
              found={found}
              words={words}
              town={place}
              saving={saving}
              onAnswer={answerMeeting}
              onNext={(calendar: CalendarId | null) =>
                advance('warm-meeting', {
                  meetingAnswer: answer?.kind ?? null,
                  calendar,
                })
              }
            />
          )
        }
        if (id === 'warm-briefing' && meeting) {
          return (
            <BriefingStep
              meeting={meeting}
              name={fullName}
              place={place}
              onRemind={remind}
              onNext={(reminder) =>
                advance('warm-briefing', { textReminder: reminder })
              }
            />
          )
        }
        if (id === 'warm-residents') {
          return (
            <ResidentsStep
              voices={voices}
              syntheticCount={syntheticCount}
              place={place}
              offer={offer}
              panelDay={panelDay}
              startAt={residentsAt}
              inviteChunk={(elect) =>
                inviteChunk({ name: fullName, title: officeTitle, elect })
              }
              swornIn={swornIn}
              saving={saving}
              onSetUp={setUpPanel}
              onNext={({ panel, sawComments, edited, choice }) =>
                advance('warm-residents', {
                  civicPanel: panel,
                  sawComments,
                  editedInvite: edited,
                  firstSendChoice: choice,
                })
              }
            />
          )
        }
        if (id === 'warm-priorities') {
          return (
            <PrioritiesStep
              cards={cards}
              kind={focus?.kind ?? 'community'}
              place={place}
              words={words}
              searching={focusSearching}
              saving={saving}
              picked={picked}
              onPick={setPickedKey}
              onNext={() => void saveFocus()}
            />
          )
        }
        if (id === 'warm-recap') {
          return (
            <RecapStep
              firstName={firstName}
              rows={recapRows}
              saving={saving}
              onDone={() => void finish()}
            />
          )
        }
        return null
      }}
    </WarmWelcomeShell>
  )
}

// Opens the warm welcome for someone who just won, and the stepper
// onboarding (`fallback`) for every other office.
export const WarmWelcomeGate = ({
  fallback,
}: {
  fallback: ReactNode
}): React.JSX.Element => {
  const { data, isPending } = useQuery(warmWelcomeOfficeQueryOptions)
  if (isPending) return <Loading />
  if (!data) return <>{fallback}</>
  return <WarmWelcomeFlow data={data} />
}
