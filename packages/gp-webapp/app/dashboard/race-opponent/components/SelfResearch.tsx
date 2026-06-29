'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, LoaderCircleIcon, TriangleAlertIcon } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { useSnackbar } from 'helpers/useSnackbar'
import type {
  SelfResearchFinding,
  SelfResearchStatusResponse,
} from 'gpApi/api-endpoints'
import type { RaceOpponentResearchStatus } from '@goodparty_org/contracts'
import SelfResearchIntakeForm, {
  type SelfResearchIntake,
} from './SelfResearchIntakeForm'
import SelfResearchReport from './SelfResearchReport'

// How often to poll status while the self-research pass is queued or running.
const POLL_INTERVAL_MS = 5000

type Props = {
  initialStatus: SelfResearchStatusResponse
  intakeDefaults?: Partial<SelfResearchIntake>
}

const SelfResearch = ({
  initialStatus,
  intakeDefaults,
}: Props): React.JSX.Element => {
  const { errorSnackbar } = useSnackbar()
  const [status, setStatus] = useState<RaceOpponentResearchStatus>(
    initialStatus.status,
  )
  const [findings, setFindings] = useState<SelfResearchFinding[] | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Synchronous in-flight guard. The `submitting` state is stale inside the
  // submit closure until React re-renders, so without this a double-submit (or
  // a poll-driven re-entry) could fire a second paid run before the button
  // disables.
  const startingRef = useRef(false)

  const loadStatus =
    useCallback(async (): Promise<RaceOpponentResearchStatus> => {
      const { data } = await clientRequest(
        'GET /v1/campaigns/mine/race-opponent/self-research/status',
        {},
      )
      setStatus(data.status)
      return data.status
    }, [])

  const loadReport = useCallback(async (): Promise<void> => {
    const { data } = await clientRequest(
      'GET /v1/campaigns/mine/race-opponent/self-research/report',
      {},
    )
    setFindings(data.research.findings)
  }, [])

  const start = useCallback(async (): Promise<void> => {
    if (startingRef.current) return
    startingRef.current = true
    setSubmitting(true)
    try {
      const { data } = await clientRequest(
        'POST /v1/campaigns/mine/race-opponent/self-research',
        {},
      )
      setStatus(data.research.status)
    } catch {
      errorSnackbar('Could not start self-research. Please try again.')
    } finally {
      startingRef.current = false
      setSubmitting(false)
    }
  }, [errorSnackbar])

  // Poll while the pass is in flight. On completion, fetch the report once.
  // After a few consecutive poll failures, stop and notify rather than spinning
  // forever on a generating screen.
  useEffect(() => {
    if (status !== 'queued' && status !== 'running') return
    let consecutiveErrors = 0
    const id = setInterval(() => {
      void loadStatus()
        .then(() => {
          consecutiveErrors = 0
        })
        .catch(() => {
          consecutiveErrors += 1
          if (consecutiveErrors >= 3) {
            clearInterval(id)
            errorSnackbar(
              'Lost contact with the server while checking status. Refresh to try again.',
            )
          }
        })
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [status, loadStatus, errorSnackbar])

  // When the pass completes, pull the report once. Guarded on findings being
  // unloaded so a status refresh on an already-rendered report doesn't refetch.
  useEffect(() => {
    if (status !== 'completed' || findings !== null) return
    void loadReport().catch(() => {
      errorSnackbar(
        'Your report is ready, but it failed to load. Refresh to view it.',
      )
    })
  }, [status, findings, loadReport, errorSnackbar])

  const isGenerating = status === 'queued' || status === 'running'

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-6 pb-28 pt-6">
      <header className="flex flex-col gap-0.5">
        <h1 className="text-xl font-semibold text-foreground">
          Research yourself first
        </h1>
        <p className="text-sm text-muted-foreground">
          Before you research your opponents, see what they can find on you.
          This private report lists sourced vulnerabilities in your public
          footprint, each with a drafted response.
        </p>
      </header>

      {status === 'not_started' && (
        <SelfResearchIntakeForm
          initialValues={intakeDefaults}
          submitting={submitting}
          onSubmit={() => void start()}
        />
      )}

      {isGenerating && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-8 text-center">
          <LoaderCircleIcon className="size-8 animate-spin text-primary" />
          <p className="text-base font-medium text-foreground">
            Running your self-research pass
          </p>
          <p className="text-sm text-muted-foreground">
            This can take a few minutes. You can leave this page and come back —
            we&apos;ll pick up where it left off.
          </p>
        </div>
      )}

      {status === 'failed' && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-destructive bg-destructive/5 p-8 text-center">
          <TriangleAlertIcon className="size-8 text-destructive" />
          <p className="text-base font-medium text-foreground">
            Your self-research pass didn&apos;t complete
          </p>
          <p className="text-sm text-muted-foreground">
            Something went wrong while researching your footprint. Try running
            it again.
          </p>
          <Button
            onClick={() => void start()}
            loading={submitting}
            loadingText="Starting…"
          >
            Try again
          </Button>
        </div>
      )}

      {status === 'completed' &&
        (findings === null ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-8 text-center">
            <LoaderCircleIcon className="size-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Loading your report&hellip;
            </p>
          </div>
        ) : (
          <SelfResearchReport findings={findings} />
        ))}
    </div>
  )
}

export default SelfResearch
