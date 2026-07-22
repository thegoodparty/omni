'use client'
import { useElectedOffice } from '@shared/hooks/useElectedOffice'
import { useWinCrmFlag } from '@shared/experiments/winCrmFlag'
import { useServeCrmFlag } from '@shared/experiments/serveCrmFlag'
import { useWinVoterContext } from './useWinVoterContext'

export interface CrmEnabled {
  // Mode-aware CRM gate layered on the existing gates: in a Serve context
  // (elected office exists) serve-crm decides; in a Win context (no elected
  // office) win-crm decides — so the two rollouts move on independent
  // cadences without either flag leaking into the other mode.
  enabled: boolean
  // enabled reads false until every input that can flip it settles (the
  // Win-vs-Serve mode decision and the deciding flag). Branch user-facing
  // rendering on ready, not enabled alone, or a CRM user briefly renders the
  // non-CRM experience.
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
  // Only the mode's deciding flag may emit an exposure, and only once the mode
  // has settled — otherwise a Serve treatment surface would inflate win-crm's
  // exposed population (and vice versa). Default false: most readers route or
  // gate, they aren't the treatment surface; that surface passes true.
  const winCrm = useWinCrmFlag(trackExposure && isModeReady && isWin)
  const serveCrm = useServeCrmFlag(trackExposure && isModeReady && isServe)
  const decidingFlag = isServe ? serveCrm : winCrm
  const ready = isModeReady && decidingFlag.ready
  const enabled = isServe ? serveCrm.enabled : isWin && winCrm.enabled

  return { enabled: ready && enabled, ready }
}
