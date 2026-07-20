'use client'
import { useElectedOffice } from '@shared/hooks/useElectedOffice'

export interface WinVoterContext {
  // Win = not an elected official. This is the one Win-vs-Serve decision for
  // the shared Contacts experience; the provider, the page heading/stats, and
  // the mobile title all read it from here so they can't drift (ENG-10448 —
  // Win must never say "constituent").
  isWin: boolean
  // isWin reads false until the elected-office query settles. Branch
  // user-facing copy on isReady, not isWin alone, or a Win user briefly
  // renders Serve labels.
  isReady: boolean
}

export const useWinVoterContext = (): WinVoterContext => {
  const { data: electedOffice, isLoading: isElectedOfficeLoading } =
    useElectedOffice()

  return {
    isWin: !isElectedOfficeLoading && !electedOffice,
    isReady: !isElectedOfficeLoading,
  }
}
