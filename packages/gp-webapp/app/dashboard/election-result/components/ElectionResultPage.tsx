'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateCampaign } from 'app/onboarding/shared/ajaxActions'
import { useSnackbar } from 'helpers/useSnackbar'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { LuTrophy, LuFrown } from 'react-icons/lu'
import { useCampaign } from '@shared/hooks/useCampaign'
import ResultOptionButton from './ResultOptionButton'
import { clientRequest } from 'gpApi/typed-request'
import type { ElectedOffice } from 'gpApi/api-endpoints'
import { useQueryClient } from '@tanstack/react-query'
import {
  ORGANIZATIONS_QUERY_KEY,
  useSetOrganizationSlug,
} from '@shared/organization-picker'
import { CAMPAIGN_QUERY_KEY } from '@shared/hooks/CampaignProvider'
import { usePositionName } from '@shared/hooks/usePositionName'
import { useIsImpersonating } from '@shared/hooks/useIsImpersonating'
import {
  Alert,
  AlertDescription,
  AlertAction,
} from '@styleguide/components/ui/alert'
import { Button } from '@styleguide/components/ui/button'
import { InfoIcon } from '@styleguide/components/ui/icons'
import {
  buildDisabledRanges,
  CALENDAR_END,
  CALENDAR_START,
  TermDatesFields,
  termDateError,
  termDatesValid,
  toApiDate,
  type DisabledRange,
} from 'app/serve/onboarding/termDates.shared'
import { dismissElectionResult } from '../dismissal'

const RESULT_WON = 'won'
const RESULT_LOST = 'lost'

interface ResultOption {
  key: string
  label: string
  icon: React.ReactNode
}

const options: ResultOption[] = [
  { key: RESULT_WON, label: 'I won my race', icon: <LuTrophy size={24} /> },
  {
    key: RESULT_LOST,
    label: 'I lost my race',
    icon: <LuFrown size={24} />,
  },
  // {
  //   key: 'runoff',
  //   label: 'Neither, I am in a run-off election',
  //   icon: <LuMeh size={24} />,
  // },
]

interface RequestState {
  submitting: boolean
  error: boolean
}

type ResultView = 'select' | 'term-dates'

export default function ElectionResultPage(): React.JSX.Element {
  const router = useRouter()
  const [campaign] = useCampaign()
  const isImpersonating = useIsImpersonating()
  const [selectedOption, setSelectedOption] = useState<string | null>(null)
  // Winning surfaces an inline term-dates step before the elected office is
  // created, so the EO is never left in the term-date-less / not-yet-onboarded
  // limbo that post-auth routing treats as "needs serve onboarding".
  const [view, setView] = useState<ResultView>('select')
  const [termStartDate, setTermStartDate] = useState<Date | undefined>(
    undefined,
  )
  const [termEndDate, setTermEndDate] = useState<Date | undefined>(undefined)
  // The user's OTHER offices as disabled ranges, so the picker enforces the same
  // no-overlap rule the gp-api create() endpoint does (avoids a 409 on submit).
  const [otherRanges, setOtherRanges] = useState<DisabledRange[]>([])

  function handleDismiss() {
    dismissElectionResult()
    router.push('/dashboard')
  }

  const details = campaign?.details
  const goals = campaign && 'goals' in campaign ? campaign.goals : undefined
  const goalsObj = goals && typeof goals === 'object' ? goals : null
  const goalsElectionDate =
    goalsObj &&
    'electionDate' in goalsObj &&
    typeof goalsObj.electionDate === 'string'
      ? goalsObj.electionDate
      : undefined
  const electionDate = details?.electionDate || goalsElectionDate
  const positionName = usePositionName()

  const { errorSnackbar } = useSnackbar()
  const [requestState, setRequestState] = useState<RequestState>({
    submitting: false,
    error: false,
  })
  const setSelectedSlug = useSetOrganizationSlug()

  const queryClient = useQueryClient()

  const datesValid = termDatesValid(termStartDate, termEndDate, otherRanges)
  const dateError = termDateError(termStartDate, termEndDate, otherRanges)

  async function handleSelection(selection: string) {
    setSelectedOption(selection)

    // Winning: collect term dates first (next step), then create the office.
    // Defer persisting the campaign result until the dates are confirmed so an
    // abandoned flow never leaves a "won" campaign with no elected office.
    if (selection === RESULT_WON) {
      if (!electionDate) {
        errorSnackbar('Failed to submit election result.')
        setRequestState({ submitting: false, error: true })
        return
      }
      setRequestState({ submitting: true, error: false })
      // Best-effort: load any other offices the user holds so the picker can
      // block overlapping ranges. A failure just leaves the ranges empty — the
      // backend still enforces the no-overlap invariant on submit.
      const mineRes = await clientRequest(
        'GET /v1/elected-office/mine',
        {},
        { ignoreResponseError: true },
      )
      const mine = mineRes.ok ? (mineRes.data as ElectedOffice[]) : []
      setOtherRanges(buildDisabledRanges(mine, undefined))
      setRequestState({ submitting: false, error: false })
      setView('term-dates')
      return
    }

    // Lost: persist the result and route to the loss flow (unchanged).
    setRequestState({ submitting: true, error: false })
    try {
      const updated = await updateCampaign([
        { key: 'details.wonGeneral', value: false },
      ])
      if (!updated) {
        throw new Error('Failed to save election result')
      }

      if (campaign) {
        queryClient.setQueryData(CAMPAIGN_QUERY_KEY, {
          ...campaign,
          details: {
            ...campaign.details!,
            wonGeneral: false,
          },
        })
      }

      trackEvent(EVENTS.Candidacy.DidYouWinModalCompleted, {
        status: selection,
      })
      router.replace('/dashboard/election-result/loss')
    } catch (e) {
      console.error('Error submitting General Result:', e)
      errorSnackbar('Failed to submit election result.')
      setRequestState({ submitting: false, error: true })
    }
  }

  // Confirm the win: persist the result, then create the elected office WITH its
  // term dates and a completion marker. Creating it already-onboarded (term dates
  // + onboardingCompletedAt) is what keeps post-auth routing on the dashboard
  // instead of dumping a just-won official into the serve onboarding flow.
  async function handleWonConfirm() {
    if (!datesValid) return
    setRequestState({ submitting: true, error: false })
    try {
      const updated = await updateCampaign([
        { key: 'details.wonGeneral', value: true },
      ])
      if (!updated) {
        throw new Error('Failed to save election result')
      }

      if (campaign) {
        queryClient.setQueryData(CAMPAIGN_QUERY_KEY, {
          ...campaign,
          details: {
            ...campaign.details!,
            wonGeneral: true,
          },
        })
      }

      trackEvent(EVENTS.Candidacy.DidYouWinModalCompleted, {
        status: RESULT_WON,
      })

      const created = await clientRequest('POST /v1/elected-office', {
        termStartDate: toApiDate(termStartDate),
        termEndDate: toApiDate(termEndDate),
        onboardingCompletedAt: new Date().toISOString(),
      })
      if (!created.ok || !created.data) {
        throw new Error('Failed to create elected office')
      }
      const newOffice = created.data as ElectedOffice

      const organizations = await clientRequest(
        'GET /v1/organizations',
        {},
      ).then((res) => res.data.organizations)
      queryClient.setQueryData(ORGANIZATIONS_QUERY_KEY, organizations)

      const newOrg = organizations.find(
        (org) => org.electedOfficeId === newOffice.id,
      )
      if (!newOrg) {
        throw new Error('New organization not found')
      }

      setSelectedSlug(newOrg.slug)
      router.replace('/dashboard/briefings')
    } catch (e) {
      console.error('Error submitting General Result:', e)
      errorSnackbar('Failed to submit election result.')
      setRequestState({ submitting: false, error: true })
    }
  }

  useEffect(() => {
    trackEvent(EVENTS.Candidacy.DidYouWinModalViewed)
  }, [])

  const isLoading = !campaign

  return (
    <div className="flex flex-col">
      <main className="flex-1 pb-24 md:pb-0">
        <section className="max-w-screen-md mx-auto p-4 sm:p-8 lg:p-16 bg-white md:border md:border-slate-200 md:rounded-xl md:mt-12">
          {isImpersonating && (
            <Alert variant="info" icon={<InfoIcon />} className="mb-8">
              <AlertDescription>
                Impersonation mode: dismiss this without answering. It
                won&apos;t change the candidate&apos;s account, and they&apos;ll
                still see it next time.
              </AlertDescription>
              <AlertAction>
                <Button
                  type="button"
                  variant="alertFilled"
                  size="small"
                  onClick={handleDismiss}
                >
                  Dismiss
                </Button>
              </AlertAction>
            </Alert>
          )}
          <div className="flex flex-col items-center md:justify-center">
            {isLoading ? (
              <div
                className="pt-4 md:pt-16 pb-8 max-w-[450px] mx-auto w-full animate-pulse"
                aria-hidden
              >
                <div className="h-8 md:h-10 bg-slate-200 rounded w-3/4 mx-auto" />
                <div className="h-4 bg-slate-200 rounded w-5/6 mx-auto mt-6" />
                <div className="flex flex-col gap-4 mt-8 w-full">
                  <div className="h-[72px] rounded-xl border border-slate-200 bg-slate-100" />
                  <div className="h-[72px] rounded-xl border border-slate-200 bg-slate-100" />
                  <div className="h-[72px] rounded-xl border border-slate-200 bg-slate-100" />
                </div>
              </div>
            ) : view === 'term-dates' ? (
              <div className="pt-4 pb-4 max-w-[450px] mx-auto w-full">
                <h1 className="text-left md:text-center font-semibold text-2xl md:text-4xl w-full">
                  Congratulations!
                </h1>
                <p className="text-left md:text-center mt-4 text-lg font-normal text-muted-foreground w-full">
                  Add your term start and end dates so we can tailor your
                  GoodParty.org tools to your time in office.
                </p>

                <div className="mt-8">
                  <TermDatesFields
                    termStartDate={termStartDate}
                    termEndDate={termEndDate}
                    onStartChange={setTermStartDate}
                    onEndChange={setTermEndDate}
                    otherRanges={otherRanges}
                    calendarStart={CALENDAR_START}
                    calendarEnd={CALENDAR_END}
                    error={dateError}
                  />
                </div>

                <Button
                  type="button"
                  variant="default"
                  size="large"
                  className="mt-8 w-full"
                  onClick={handleWonConfirm}
                  disabled={!datesValid || requestState.submitting}
                  loading={requestState.submitting}
                >
                  Continue
                </Button>
                {requestState.error ? (
                  <p className="text-red text-center mt-4">
                    An error occurred when saving your election result, please
                    try again later.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="pt-4 pb-4 max-w-[450px] mx-auto">
                <h1
                  id="election-results-heading"
                  className="text-left md:text-center font-semibold text-2xl md:text-4xl w-full"
                >
                  Election Results:
                  <br />
                  {positionName || 'Your Office'}
                </h1>
                <p className="text-left md:text-center mt-4 text-lg font-normal text-muted-foreground w-full">
                  It looks like your general election date has passed. Please
                  confirm the outcome of your election.
                </p>

                <div
                  className="flex flex-col gap-4 mt-8"
                  role="radiogroup"
                  aria-labelledby="election-results-heading"
                >
                  {options.map((option) => (
                    <ResultOptionButton
                      key={option.key}
                      option={option}
                      selected={selectedOption === option.key}
                      submitting={requestState.submitting}
                      onSelect={handleSelection}
                    />
                  ))}
                </div>
                {requestState.error ? (
                  <p className="text-red text-center mt-4">
                    An error occurred when saving your election result, please
                    try again later.
                  </p>
                ) : null}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
