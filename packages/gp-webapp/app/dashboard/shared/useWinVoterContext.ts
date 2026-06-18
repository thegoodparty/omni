'use client'
import { useElectedOffice } from '@shared/hooks/useElectedOffice'
import { useWinVoterDataFlag } from '@shared/experiments/winVoterDataFlag'

export interface WinVoterContext {
  // Win = win-voter-data flag on and not an elected official. This is the one
  // Win-vs-Serve decision for the shared Contacts experience; the provider, the
  // page heading/stats, and the mobile title all read it from here so they
  // can't drift (ENG-10448 — Win must never say "constituent").
  isWin: boolean
  // isWin reads false until both inputs that can flip it settle (the
  // elected-office query and the win-voter-data flag). Branch user-facing copy
  // on isReady, not isWin alone, or a Win user briefly renders Serve labels.
  isReady: boolean
}

export const useWinVoterContext = (): WinVoterContext => {
  const { data: electedOffice, isLoading: isElectedOfficeLoading } =
    useElectedOffice()
  // trackExposure=false: these reads pick a label / route a query, they aren't
  // the treatment surface (PersonContent + the Contacts Viewed event are).
  const { enabled: isWinVoterDataOn, ready: isWinVoterDataFlagReady } =
    useWinVoterDataFlag(false)

  return {
    isWin: isWinVoterDataOn && !isElectedOfficeLoading && !electedOffice,
    isReady: !isElectedOfficeLoading && isWinVoterDataFlagReady,
  }
}
