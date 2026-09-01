'use client'
import { useElectedOffice } from '@shared/hooks/useElectedOffice'
import { useServeCrmFlag } from '@shared/experiments/serveCrmFlag'
import { useWinVoterContext } from './useWinVoterContext'

export interface CrmEnabled {
  // Mode-aware CRM gate: Win CRM is always on (win-crm hit 100% and was
  // removed); in a Serve context (elected office exists) serve-crm still
  // decides, on its own ramp cadence.
  enabled: boolean
  // enabled reads false until every input that can flip it settles (the
  // Win-vs-Serve mode decision and, in Serve, the deciding flag). Branch
  // user-facing rendering on ready, not enabled alone, or a CRM user briefly
  // renders the non-CRM experience.
  ready: boolean
}

export const useCrmEnabled = (trackExposure = false): CrmEnabled => {
  const { isWin, isReady: isModeReady } = useWinVoterContext()
  // Serve is decided by elected-office existence, not by !isWin: while the
  // elected-office query is still loading isWin reads false, and serve-crm
  // must never decide for it. React Query dedupes this with
  // useWinVoterContext's read of the same query.
  const { data: electedOffice } = useElectedOffice()
  const isServe = Boolean(electedOffice)
  // Only serve-crm may emit an exposure, and only once the mode has settled
  // and resolved to Serve — otherwise a Win surface reading this hook would
  // inflate serve-crm's exposed population. Default false: most readers
  // route or gate, they aren't the treatment surface; that surface passes
  // true.
  const serveCrm = useServeCrmFlag(trackExposure && isModeReady && isServe)
  const ready = isModeReady && (isServe ? serveCrm.ready : true)
  const enabled = ready && (isServe ? serveCrm.enabled : isWin)

  return { enabled, ready }
}
