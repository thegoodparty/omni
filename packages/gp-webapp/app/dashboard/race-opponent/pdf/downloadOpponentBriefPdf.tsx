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
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 100)
}
