import { useCallback, useState } from 'react'
import { weeksTill } from 'helpers/dateHelper'
import { useCampaign } from '@shared/hooks/useCampaign'

type PrimaryResult = 'won' | 'lost'

export interface PostElectionState {
  electionInPast: boolean
  primaryLost: boolean
  primaryResultModalOpen: boolean
  primaryElectionDate: string | undefined
  electionDate: string | undefined
  closePrimaryResultModal: (result?: PrimaryResult) => void
}

export function usePostElectionState(): PostElectionState {
  const [campaign] = useCampaign()
  const { goals, details } = campaign || {}
  const { primaryElectionDate, partisanType } = details || {}

  const [primaryResultState, setPrimaryResultState] = useState<{
    modalDismissed: boolean
    overrideResult: PrimaryResult | null
  }>({
    modalDismissed: false,
    overrideResult: null,
  })

  const electionDate = details?.electionDate || goals?.electionDate
  const now = new Date()
  const primaryElectionDateObj = primaryElectionDate
    ? new Date(primaryElectionDate)
    : null
  const primaryInFuture =
    primaryElectionDateObj !== null && primaryElectionDateObj > now
  const primaryInPast = primaryElectionDateObj !== null && !primaryInFuture
  const resolvedDate = primaryInFuture ? primaryElectionDate : electionDate

  // Derive primaryResult from the live campaign so persisted server values
  // are always respected after they load — local state only tracks the
  // current session's modal interaction.
  const primaryResult =
    primaryResultState.overrideResult ?? campaign?.primaryResult ?? null
  const { modalDismissed } = primaryResultState

  const weeksUntil = weeksTill(resolvedDate)
  const weeksUntilValue =
    typeof weeksUntil === 'object' && weeksUntil ? weeksUntil.weeks : NaN
  // resolvedDate represents the general election only when the primary
  // is not still ahead of us — guarding on !primaryInFuture instead of
  // string-comparing the dates avoids a false negative for campaigns
  // whose primary and general dates are identical strings.
  const electionInPast = weeksUntilValue < 0 && !primaryInFuture
  const primaryLost = primaryResult === 'lost'

  // Partisan primaries are party-nomination contests that don't apply to our
  // exclusively non-partisan candidates. Showing them the non-dismissible
  // "did you win your primary?" modal traps them: with no applicable answer
  // they pick "lost", which marks the campaign inactive and blocks Pro upgrade.
  // Skip the modal entirely for partisan primaries so they advance to the
  // general without being asked (leaving primaryResult null / active).
  // partisanType is a raw BallotReady string with several partisan variants
  // (e.g. 'partisan', 'partisan for primary only'), so match on the prefix
  // after normalizing case/whitespace — 'nonpartisan'/'non-partisan' never
  // start with 'partisan', so they are correctly excluded.
  const primaryIsPartisan =
    partisanType?.trim().toLowerCase().startsWith('partisan') ?? false

  // Suppress the primary-result modal once the general election has also
  // ended — at that point the race is over and we render ElectionOver
  // (which is the screen the modal would otherwise cover non-dismissibly).
  const primaryResultModalOpen =
    primaryInPast &&
    !primaryResult &&
    !modalDismissed &&
    !electionInPast &&
    !primaryIsPartisan

  const closePrimaryResultModal = useCallback(
    (selectedResult?: PrimaryResult) => {
      if (selectedResult) {
        setPrimaryResultState((state) => ({
          ...state,
          overrideResult: selectedResult,
        }))
      } else {
        setPrimaryResultState((state) => ({
          ...state,
          modalDismissed: true,
        }))
      }
    },
    [],
  )

  return {
    electionInPast,
    primaryLost,
    primaryResultModalOpen,
    primaryElectionDate,
    electionDate,
    closePrimaryResultModal,
  }
}
