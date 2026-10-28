'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateCampaign } from 'app/onboarding/shared/ajaxActions'
import { useSnackbar } from 'helpers/useSnackbar'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { LuTrophy } from 'react-icons/lu'
import { useCampaign } from '@shared/hooks/useCampaign'
import ResultOptionButton from './ResultOptionButton'
import { clientRequest } from 'gpApi/typed-request'
import { ORG_SLUG_HEADER } from '@shared/organizations/constants'
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
import { ClockIcon, HeartIcon, InfoIcon } from '@styleguide/components/ui/icons'
import { SERVE_ONBOARDING_PATH } from 'helpers/resolvePostAuthRedirectPath.util'
import { dismissElectionResult, snoozeElectionResult } from '../dismissal'
import { ASK_COPY, electionDayLabel } from '../electionResultCopy'
import { electionDateOf } from '../electionResultQuestion'
import { ActiveProSubscriptionAlert } from './ActiveProSubscriptionAlert'
import { CongratulationsStep } from './CongratulationsStep'
import { MY_ELECTED_OFFICES_QUERY_KEY } from 'app/dashboard/shared/myElectedOfficesQuery'

const RESULT_WON = 'won'
const RESULT_LOST = 'lost'
const RESULT_NOT_FINAL = 'not-final'

interface ResultOption {
  key: string
  label: string
  icon: React.ReactNode
}

const options: ResultOption[] = [
  {
    key: RESULT_WON,
    label: ASK_COPY.won,
    icon: <LuTrophy size={24} className="text-primary" />,
  },
  {
    key: RESULT_LOST,
    label: ASK_COPY.lost,
    icon: <HeartIcon size={24} className="text-muted-foreground" />,
  },
  {
    key: RESULT_NOT_FINAL,
    label: ASK_COPY.notFinal,
    icon: <ClockIcon size={24} className="text-muted-foreground" />,
  },
]

interface RequestState {
  submitting: boolean
  error: boolean
}

// The campaign keeps Win onboarding's party values; the office takes Serve's.
// A major party is left off so Serve onboarding asks, and blocks, at its own
// party step.
export const servePartyFromCampaign = (
  campaignParty: string | undefined,
): string | undefined => {
  const party = campaignParty?.trim().toLowerCase()
  if (!party) return undefined
  if (party === 'nonpartisan') return 'nonpartisan'
  if (['democrat', 'democratic', 'republican'].includes(party)) return undefined
  return 'independent'
}

export default function ElectionResultPage({
  startWithWin = false,
}: {
  // Set when the campaign manager chat's "I won" opens this page, so it goes
  // straight to the congratulations instead of asking again.
  startWithWin?: boolean
}): React.JSX.Element {
  const router = useRouter()
  const [campaign] = useCampaign()
  const isImpersonating = useIsImpersonating()
  const [selectedOption, setSelectedOption] = useState<string | null>(null)
  const [view, setView] = useState<'ask' | 'won'>('ask')

  function handleDismiss() {
    dismissElectionResult()
    router.push('/dashboard')
  }

  const positionName = usePositionName()

  const { errorSnackbar } = useSnackbar()
  const [requestState, setRequestState] = useState<RequestState>({
    submitting: false,
    error: false,
  })
  const setSelectedSlug = useSetOrganizationSlug()

  const queryClient = useQueryClient()

  const saveResult = async (wonGeneral: boolean): Promise<void> => {
    const updated = await updateCampaign([
      { key: 'details.wonGeneral', value: wonGeneral },
    ])
    if (!updated) {
      throw new Error('Failed to save election result')
    }
    if (campaign) {
      queryClient.setQueryData(CAMPAIGN_QUERY_KEY, {
        ...campaign,
        details: {
          ...campaign.details!,
          wonGeneral,
        },
      })
    }
  }

  // A Pro winner moves into Serve onboarding. The office is created first and
  // left unfinished (no onboardingCompletedAt): onboarding's pledge finishes
  // it, and until then the dashboard sends them back to onboarding. It is
  // created before the campaign is flagged won, so a failed create never
  // leaves a won campaign with no office.
  const startServeHandoff = async (): Promise<void> => {
    // Pinned to the campaign org: the backend links campaignId and copies the
    // campaign's position from this header. The cookie can point at another
    // `eo-<id>` org the user already holds, which would link no campaign.
    const created = await clientRequest(
      'POST /v1/elected-office',
      {
        party: servePartyFromCampaign(campaign?.details?.party),
        onboardingStep: 'confirm',
      },
      campaign
        ? { headers: { [ORG_SLUG_HEADER]: `campaign-${campaign.id}` } }
        : undefined,
    )
    if (!created.ok || !created.data) {
      throw new Error('Failed to create elected office')
    }
    const newOffice = created.data as ElectedOffice
    await queryClient.invalidateQueries({
      queryKey: MY_ELECTED_OFFICES_QUERY_KEY,
    })

    await saveResult(true)
    trackEvent(EVENTS.Candidacy.DidYouWinModalCompleted, {
      status: RESULT_WON,
    })

    // Best-effort: the office and result are saved, so a failed org refresh
    // must not read as an error. Serve onboarding's own guard switches to the
    // office's org when the cookie still names the campaign.
    try {
      const organizations = await clientRequest(
        'GET /v1/organizations',
        {},
      ).then((res) => res.data.organizations)
      queryClient.setQueryData(ORGANIZATIONS_QUERY_KEY, organizations)

      const newOrg = organizations.find(
        (org) => org.electedOfficeId === newOffice.id,
      )
      if (newOrg) {
        setSelectedSlug(newOrg.slug)
      }
    } catch (e) {
      console.error('Error switching to elected-office org:', e)
    }

    setRequestState({ submitting: false, error: false })
    router.replace(SERVE_ONBOARDING_PATH)
  }

  // A Pro winner's result is saved by the congratulations screen's button,
  // together with the office.
  const handleStartServing = async (): Promise<void> => {
    setRequestState({ submitting: true, error: false })
    try {
      await startServeHandoff()
    } catch (e) {
      console.error('Error submitting General Result:', e)
      errorSnackbar('Failed to submit election result.')
      setRequestState({ submitting: false, error: true })
    }
  }

  async function handleSelection(selection: string) {
    setSelectedOption(selection)
    if (selection === RESULT_NOT_FINAL) {
      if (campaign) snoozeElectionResult(campaign.id)
      router.replace('/dashboard')
      return
    }
    if (selection === RESULT_WON && campaign?.isPro) {
      setView('won')
      return
    }
    setRequestState({ submitting: true, error: false })
    try {
      // Without Pro a win saves the result only: no office, no Serve.
      await saveResult(selection === RESULT_WON)
      trackEvent(EVENTS.Candidacy.DidYouWinModalCompleted, {
        status: selection,
      })
      if (selection === RESULT_WON) {
        setRequestState({ submitting: false, error: false })
        setView('won')
        return
      }
      router.replace('/dashboard/election-result/loss')
    } catch (e) {
      console.error('Error submitting General Result:', e)
      errorSnackbar('Failed to submit election result.')
      setRequestState({ submitting: false, error: true })
    }
  }

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [view])

  const startedWithWinRef = useRef(false)
  useEffect(() => {
    if (!startWithWin || !campaign || startedWithWinRef.current) return
    startedWithWinRef.current = true
    void handleSelection(RESULT_WON)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the campaign loads
  }, [startWithWin, campaign])

  const electionDay = electionDayLabel(electionDateOf(campaign))

  useEffect(() => {
    trackEvent(EVENTS.Candidacy.DidYouWinModalViewed)
  }, [])

  const isLoading =
    !campaign || (startWithWin && view === 'ask' && !requestState.error)

  return (
    <div className="flex flex-col">
      <main className="flex-1 pb-24 md:pb-0">
        <section
          className={`${view === 'won' && campaign?.isPro ? 'max-w-4xl lg:p-10' : 'max-w-screen-md lg:p-16'} mx-auto p-4 sm:p-8 bg-white md:border md:border-slate-200 md:rounded-xl md:mt-12`}
        >
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
          {view === 'ask' && <ActiveProSubscriptionAlert className="mb-8" />}
          <div className="flex flex-col items-center md:justify-center">
            {view === 'won' ? (
              <CongratulationsStep
                isPro={!!campaign?.isPro}
                submitting={requestState.submitting}
                onStartServing={() => void handleStartServing()}
                onBackToDashboard={() => router.replace('/dashboard')}
              />
            ) : isLoading ? (
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
            ) : (
              <div className="pt-4 pb-4 max-w-[450px] mx-auto">
                <h1
                  id="election-results-heading"
                  className="text-left md:text-center font-semibold text-2xl md:text-4xl w-full"
                >
                  {ASK_COPY.title(positionName || null)}
                </h1>
                <p className="text-left md:text-center mt-3 text-lg font-normal text-muted-foreground w-full">
                  {ASK_COPY.description(electionDay)}
                </p>

                <div
                  className="flex flex-col gap-3 mt-8"
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
