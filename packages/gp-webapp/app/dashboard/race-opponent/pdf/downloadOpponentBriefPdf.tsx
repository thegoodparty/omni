'use client'

import { pdf } from '@react-pdf/renderer'
import type { RaceOpponentResponse } from 'gpApi/api-endpoints'
import { OpponentBriefPdfDocument } from './OpponentBriefPdfDocument'
import { buildOpponentBrief, opponentsWithBrief } from './opponentBriefContent'

type Opponent = RaceOpponentResponse['opponents'][number]

// Generates a single PDF holding one brief per opponent that has a structured
// summary, in roster order, and triggers a browser download. No-ops when no
// opponent has a brief (the caller also disables the button in that case).
export const downloadOpponentBriefsPdf = async (
  opponents: Opponent[],
  raceContext?: string,
): Promise<void> => {
  const briefs = opponentsWithBrief(opponents).map((opponent) => ({
    brief: buildOpponentBrief(opponent),
    opponentName: opponent.opponentName,
  }))
  if (briefs.length === 0) return

  const blob = await pdf(
    <OpponentBriefPdfDocument briefs={briefs} raceContext={raceContext} />,
  ).toBlob()

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'opponent-briefs.pdf'
  document.body.appendChild(a)
  a.click()
  // Detach the anchor and free the object URL only after the browser has read
  // the blob. Doing either in the same tick as click() cancels the download in
  // current Chrome (the Save-As dialog appears but writes nothing / surfaces as
  // a spurious "check your internet connection" error). Matches the campaign
  // plan / ordinance-export fix (ENG-10905 / ENG-10860 / ENG-10953).
  setTimeout(() => {
    a.remove()
    URL.revokeObjectURL(url)
  }, 10_000)
}
