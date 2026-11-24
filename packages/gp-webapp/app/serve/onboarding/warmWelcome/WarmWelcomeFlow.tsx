import { useEffect, useMemo, useState, type ReactNode } from 'react'
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
import { onboardingDistrictStatsQueryOptions } from 'app/onboarding/components/VoterDemographicsStep'
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
  type CalendarId,
  type FirstMeeting,
} from './firstMeeting'
import { MeetingStep, type MeetingAnswer } from './MeetingStep'
import { RecapStep } from './RecapStep'
import { WarmWelcomeShell } from './WarmWelcomeShell'
import { WonStep } from './WonStep'
import {
  isWarmWelcomeOffice,
  resumeWarmWelcomeStep,
  WARM_WELCOME_COPY,
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
  positionId: string | undefined
}

// Null when the user has no office the warm welcome can finish, which sends
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
      positionId: org?.position?.brPositionId ?? undefined,
    }
  },
})

const Loading = (): React.JSX.Element => (
  <div className="flex min-h-[60vh] items-center justify-center">
    <Spinner />
  </div>
)

// The number on the first step is worth a short wait, not a long one.
const POPULATION_WAIT_MS = 4000

const WarmWelcomeFlow = ({
  data,
}: {
  data: WarmWelcomeOffice
}): React.JSX.Element => {
  const { office, party, place, positionId } = data
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

  const found = useMemo(
    () =>
      firstMeetingFrom(
        meetingsQuery.data?.meetings ?? [],
        parseDay(office.termStartDate),
        startOfDay(new Date()),
      ),
    [meetingsQuery.data, office.termStartDate],
  )
  const [answer, setAnswer] = useState<MeetingAnswer | null>(null)
  const meeting: FirstMeeting | null = answer ? answer.meeting : found
  const steps = warmWelcomeSteps({
    foundMeeting: found !== null,
    knownMeeting: meeting !== null,
  })

  const [populationWaitOver, setPopulationWaitOver] = useState(false)
  useEffect(() => {
    const timer = setTimeout(
      () => setPopulationWaitOver(true),
      POPULATION_WAIT_MS,
    )
    return () => clearTimeout(timer)
  }, [])

  // Chosen once, when the data the first screen needs is in: where to
  // resume, and whether the first step has a number to count to.
  const [start, setStart] = useState<{ population: number | null } | null>(null)
  const [step, setStep] = useState<WarmWelcomeStepId | null>(null)
  const ready =
    !meetingsQuery.isLoading && (!statsQuery.isLoading || populationWaitOver)
  useEffect(() => {
    if (!ready || start) return
    setStart({ population: statsQuery.data?.districtPopulation ?? null })
    setStep(resumeWarmWelcomeStep(office.onboardingStep, steps))
  }, [ready, start, office.onboardingStep, steps, statsQuery.data])

  useEffect(() => {
    if (!step) return
    trackServeOnboarding(WARM_WELCOME_EVENTS[step].viewed, {
      electedOfficeId: office.id,
    })
  }, [step, office.id])

  const [saving, setSaving] = useState(false)

  const advance = (
    from: WarmWelcomeStepId,
    properties: Record<string, string | boolean | null> = {},
  ): void => {
    const next = steps[steps.indexOf(from) + 1]
    if (!next) return
    trackServeOnboarding(WARM_WELCOME_EVENTS[from].completed, {
      electedOfficeId: office.id,
      ...properties,
    })
    setStep(next)
    // The checkpoint is saved behind the move, so it never holds the motion.
    clientRequest('PUT /v1/elected-office/:id', {
      id: office.id,
      onboardingStep: next,
    }).catch((err: Error) =>
      reportClientError(err, { context: 'serveWarmWelcome.checkpoint' }),
    )
  }

  // Done is the completion save: it makes the office live, which starts
  // Meeting Briefings and the full community issues run. The term is already
  // on the office. No pledge was shown here, so pledgedAt is left as it is.
  const finish = async (): Promise<void> => {
    setSaving(true)
    try {
      await clientRequest('PUT /v1/elected-office/:id', {
        id: office.id,
        party,
        onboardingCompletedAt: new Date().toISOString(),
        onboardingStep: 'warm-recap',
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
      window.location.href = `/post-auth-redirect?${handoff.toString()}`
    } catch (err) {
      reportClientError(err, { context: 'serveWarmWelcome.finish' })
      errorSnackbar(WARM_WELCOME_COPY.recap.saveFailed)
      setSaving(false)
    }
  }

  if (!start || !step) return <Loading />

  const notice: ReactNode = isImpersonating ? (
    <Alert variant="info" icon={<InfoIcon />} className="mx-4 mb-2">
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

  return (
    <WarmWelcomeShell
      steps={steps}
      step={step}
      onGoTo={setStep}
      notice={notice}
    >
      {(id) => {
        if (id === 'warm-won') {
          return (
            <WonStep
              firstName={firstName}
              place={place}
              population={start.population}
              onNext={() =>
                advance('warm-won', {
                  hasPopulation: start.population !== null,
                })
              }
            />
          )
        }
        if (id === 'warm-meeting' && found) {
          return (
            <MeetingStep
              found={found}
              onAnswer={setAnswer}
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
              onNext={() => advance('warm-briefing')}
            />
          )
        }
        if (id === 'warm-recap') {
          return (
            <RecapStep
              firstName={firstName}
              meeting={meeting}
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

// Opens the warm welcome for an office it can finish, and the stepper
// onboarding (`fallback`) for every other one.
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
