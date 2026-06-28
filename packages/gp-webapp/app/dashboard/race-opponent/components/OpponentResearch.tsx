'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, LoaderCircleIcon, TriangleAlertIcon } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { useSnackbar } from 'helpers/useSnackbar'
import type {
  OpponentProfileResponse,
  RaceOpponentActivityResponse,
  SelfResearchFinding,
} from 'gpApi/api-endpoints'
import type { RaceOpponentResearchStatus } from '@goodparty_org/contracts'
import RadioGroup, { RadioCardItem } from '@shared/inputs/RadioGroup'
import OpponentHandbook from './OpponentHandbook'
import OpponentActivityFeed from './OpponentActivityFeed'

// How often to poll the opponent profile while a research pass is in flight.
const POLL_INTERVAL_MS = 5000

type Props = {
  opponentNames: string[]
  // The opponent already under research (with its findings), when a pass exists.
  initialProfile: OpponentProfileResponse | null
  initialActivity: RaceOpponentActivityResponse | null
}

// A returning candidate must land on their Handbook (or the failure UI), not the
// confirm gate — and must never be nudged to re-fire research on a pass that
// already exists. The activity stream the page already fetches is the signal:
// findings present, or a settled (completed/failed) scheduled run, all mean a
// pass has run. (A bare refresh.status of 'running' is NOT a signal — gp-api
// defaults to 'running' when there's no run at all, so it can't distinguish a
// brand-new candidate from a genuine in-flight run; only the unambiguous signals
// below count as existing research.)
const hasExistingResearch = (
  activity: RaceOpponentActivityResponse | null,
): boolean => {
  if (!activity) return false
  return (
    activity.findings.length > 0 ||
    activity.refresh.status === 'completed' ||
    activity.refresh.status === 'failed'
  )
}

// Seed the research status for a returning candidate from the activity refresh
// status: a settled completed/failed run maps straight through; findings without
// a settled status (a completed run that just isn't reported settled) still mean
// the Handbook should show, so default to completed.
const seededStatus = (
  activity: RaceOpponentActivityResponse | null,
): RaceOpponentResearchStatus | null => {
  if (!hasExistingResearch(activity)) return null
  if (activity?.refresh.status === 'failed') return 'failed'
  return 'completed'
}

const OpponentResearch = ({
  opponentNames,
  initialProfile,
  initialActivity,
}: Props): React.JSX.Element => {
  const { errorSnackbar } = useSnackbar()

  const existedAtMount = hasExistingResearch(initialActivity)

  // The opponent the candidate has confirmed for research. Defaults to the
  // already-researched opponent if its name is known. When only the activity
  // stream tells us a pass exists (no name on hand), confirmedName stays null but
  // the existing-research path still renders the Handbook/failure UI past the
  // confirm gate.
  const [confirmedName, setConfirmedName] = useState<string | null>(
    initialProfile?.research.opponentName ?? null,
  )
  const [selectedName, setSelectedName] = useState<string>(
    opponentNames[0] ?? '',
  )
  // Seed status/findings from existing research so the Handbook (or failure UI)
  // renders on first paint without a round-trip. The activity findings are a
  // superset of the Handbook's finding shape, so they render directly.
  const [status, setStatus] = useState<RaceOpponentResearchStatus | null>(
    initialProfile?.research.status ?? seededStatus(initialActivity),
  )
  const [findings, setFindings] = useState<SelfResearchFinding[] | null>(
    initialProfile?.research.findings ??
      (existedAtMount ? (initialActivity?.findings ?? []) : null),
  )
  const [activity, setActivity] = useState<RaceOpponentActivityResponse | null>(
    initialActivity,
  )
  const [starting, setStarting] = useState(false)
  // Synchronous in-flight guard. The `starting` state is stale inside the start
  // closure until React re-renders, so without this a double-click could fire a
  // second paid run before the button disables.
  const startingRef = useRef(false)

  const loadProfile = useCallback(
    async (name: string): Promise<RaceOpponentResearchStatus> => {
      const { data } = await clientRequest(
        'GET /v1/campaigns/mine/race-opponent/opponents/profile',
        { opponentName: name },
      )
      setStatus(data.research.status)
      setFindings(data.research.findings)
      return data.research.status
    },
    [],
  )

  const loadActivity = useCallback(async (): Promise<void> => {
    const { data } = await clientRequest(
      'GET /v1/campaigns/mine/race-opponent/opponents/activity',
      {},
    )
    setActivity(data)
  }, [])

  // Dispatch research for an EXPLICIT opponent name. Both the confirm step and
  // the failure retry route through here so the dispatched name is always the one
  // the candidate chose — never a positional default like opponentNames[0].
  const dispatchResearch = useCallback(
    async (rawName: string): Promise<void> => {
      if (startingRef.current) return
      const name = rawName.trim()
      if (name.length === 0) return
      startingRef.current = true
      setStarting(true)
      try {
        const { data } = await clientRequest(
          'POST /v1/campaigns/mine/race-opponent/opponents/research',
          { opponentName: name },
        )
        setConfirmedName(name)
        setStatus(data.research.status)
      } catch {
        errorSnackbar('Could not start opponent research. Please try again.')
      } finally {
        startingRef.current = false
        setStarting(false)
      }
    },
    [errorSnackbar],
  )

  // Confirmation gate: research never starts until the candidate explicitly
  // confirms a match. We never auto-dispatch on a roster namesake.
  const confirm = useCallback(
    (): Promise<void> => dispatchResearch(selectedName),
    [dispatchResearch, selectedName],
  )

  // Retry a failed pass for the SAME confirmed opponent. When the name isn't
  // known (a failed-returning candidate seeded from the activity stream, which
  // doesn't carry the name), don't dispatch blind — route back to the confirm
  // step so the candidate re-picks rather than silently researching the wrong
  // (positional-default) opponent.
  const retry = useCallback((): void => {
    if (confirmedName) {
      void dispatchResearch(confirmedName)
      return
    }
    setStatus(null)
  }, [confirmedName, dispatchResearch])

  // Poll the profile while the pass is queued or running. On completion, the
  // profile response already carries the findings, so no extra fetch is needed.
  // After a few consecutive poll failures, stop and notify rather than spinning
  // forever on a generating screen.
  useEffect(() => {
    if (!confirmedName) return
    if (status !== 'queued' && status !== 'running') return
    let consecutiveErrors = 0
    const id = setInterval(() => {
      void loadProfile(confirmedName)
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
  }, [confirmedName, status, loadProfile, errorSnackbar])

  // When the pass completes, load the activity stream once so the candidate sees
  // the monitored "what's new" feed alongside the Handbook.
  useEffect(() => {
    if (status !== 'completed' || activity !== null) return
    void loadActivity().catch(() => {
      // The Handbook is the primary surface; a failed activity load is
      // non-blocking, so leave the section empty rather than erroring the page.
    })
  }, [status, activity, loadActivity])

  const isGenerating = status === 'queued' || status === 'running'
  // Confirm only when there is genuinely no existing or in-flight pass. A
  // returning candidate (status seeded from existing research) never sees it, so
  // research can't be re-fired on a pass that already exists.
  const showConfirm = status === null

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 px-6 pb-28 pt-6">
      <header className="flex flex-col gap-0.5">
        <h1 className="text-xl font-semibold text-foreground">
          Know your opponent
        </h1>
        <p className="text-sm text-muted-foreground">
          Confirm your opponent, then see a sourced profile of what we found and
          stay on top of anything new.
        </p>
      </header>

      {showConfirm && (
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-foreground">
              Confirm your opponent
            </h2>
            <p className="text-sm text-muted-foreground">
              We defaulted this from your race&apos;s candidate roster. Confirm
              the right match before we research them — we won&apos;t start on a
              name you haven&apos;t confirmed.
            </p>
          </div>

          {opponentNames.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              We couldn&apos;t find opponents on your race&apos;s roster yet.
              Check back once your race details are complete.
            </p>
          ) : (
            <RadioGroup
              name="opponent"
              value={selectedName}
              onValueChange={setSelectedName}
            >
              {opponentNames.map((name) => (
                <RadioCardItem
                  key={name}
                  id={`opponent-${name}`}
                  value={name}
                  title={name}
                />
              ))}
            </RadioGroup>
          )}

          <Button
            onClick={() => void confirm()}
            disabled={selectedName.trim().length === 0}
            loading={starting}
            loadingText="Starting…"
          >
            Confirm and research
          </Button>
        </div>
      )}

      {!showConfirm && isGenerating && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-8 text-center">
          <LoaderCircleIcon className="size-8 animate-spin text-primary" />
          <p className="text-base font-medium text-foreground">
            {confirmedName
              ? `Researching ${confirmedName}`
              : 'Researching your opponent'}
          </p>
          <p className="text-sm text-muted-foreground">
            This can take a few minutes. You can leave this page and come back —
            we&apos;ll pick up where it left off.
          </p>
        </div>
      )}

      {!showConfirm && status === 'failed' && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-destructive bg-destructive/5 p-8 text-center">
          <TriangleAlertIcon className="size-8 text-destructive" />
          <p className="text-base font-medium text-foreground">
            Opponent research didn&apos;t complete
          </p>
          <p className="text-sm text-muted-foreground">
            Something went wrong while researching{' '}
            {confirmedName ?? 'your opponent'}.{' '}
            {confirmedName
              ? 'Try again.'
              : 'Pick your opponent again to retry.'}
          </p>
          <Button onClick={retry} loading={starting} loadingText="Starting…">
            {confirmedName ? 'Try again' : 'Choose opponent'}
          </Button>
        </div>
      )}

      {!showConfirm && status === 'completed' && findings !== null && (
        <div className="flex flex-col gap-10">
          <OpponentHandbook opponentName={confirmedName} findings={findings} />
          <section className="flex flex-col gap-3">
            <header className="flex flex-col gap-0.5">
              <h2 className="text-lg font-semibold text-foreground">
                What&apos;s new
              </h2>
              <p className="text-sm text-muted-foreground">
                New sourced findings since you last checked, as we keep
                monitoring.
              </p>
            </header>
            {activity ? (
              <OpponentActivityFeed activity={activity} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Loading what&apos;s new&hellip;
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

export default OpponentResearch
