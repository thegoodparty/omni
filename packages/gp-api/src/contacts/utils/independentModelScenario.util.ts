import type { CampaignStrategyContextCandidate } from '@/elections/types/elections.types'
import type { AffinityColumn } from '@/peopleDb/affinityColumns.const'

type MajorParty = 'D' | 'R'

// Election-api party strings are free text ("Democratic", "Democratic-Farmer-
// Labor", "Republican", "Nonpartisan", ...). Prefix matching folds the DFL into
// Democrat; everything else is neither major party.
const majorParty = (party: string | null | undefined): MajorParty | null => {
  const normalized = (party ?? '').trim().toLowerCase()
  if (normalized.startsWith('dem')) return 'D'
  if (normalized.startsWith('rep')) return 'R'
  return null
}

// Internal test candidates are seeded against real races with goodparty
// emails; the strategic-landscape path drops them for the same reason.
const isTestCandidate = (candidate: CampaignStrategyContextCandidate) =>
  candidate.email?.toLowerCase().includes('@goodparty') ?? false

type Field = { party: MajorParty | null; isIncumbent: boolean }

// One entry per person. A person listed more than once is an incumbent if any
// of their rows says so, so one stage can't overwrite another.
const dedupeByName = (
  candidates: CampaignStrategyContextCandidate[],
): Field[] => {
  const byName = new Map<string, Field>()
  for (const candidate of candidates) {
    if (isTestCandidate(candidate)) continue
    const key = candidate.full_name.trim().toLowerCase()
    const seen = byName.get(key)
    byName.set(key, {
      party: seen?.party ?? majorParty(candidate.party),
      isIncumbent:
        (seen?.isIncumbent ?? false) || candidate.is_incumbent === true,
    })
  }
  return [...byName.values()]
}

export type StateLegScenarioInput = {
  candidates: CampaignStrategyContextCandidate[]
  numberOfSeats: number | null
  partisanType: string | null | undefined
  gpCandidateParty: string | null | undefined
}

// Maps a race to one of the ten frozen state-leg scenario columns (TDD
// "Openness to an independent", section 7.3). The GP candidate is removed from
// their own party's count only when they run as a Democrat or Republican.
export const stateLegAffinityColumn = ({
  candidates,
  numberOfSeats,
  partisanType,
  gpCandidateParty,
}: StateLegScenarioInput): AffinityColumn => {
  const isMultiSeat = (numberOfSeats ?? 1) >= 2
  const field = dedupeByName(candidates)
  if (field.length === 0) {
    return isMultiSeat
      ? 'Indep_Openness_Multi_Inc'
      : 'Indep_Openness_Single_Inc'
  }

  const isNonpartisan = (partisanType ?? '')
    .toLowerCase()
    .includes('nonpartisan')
  let democrats = field.filter((c) => c.party === 'D').length
  let republicans = field.filter((c) => c.party === 'R').length
  const gpParty = majorParty(gpCandidateParty)
  if (gpParty === 'D' && democrats > 0) democrats -= 1
  if (gpParty === 'R' && republicans > 0) republicans -= 1

  const loneDemocrats = !isNonpartisan && democrats > 0 && republicans === 0
  const loneRepublicans = !isNonpartisan && republicans > 0 && democrats === 0

  if (isMultiSeat && loneDemocrats) return 'Indep_Openness_DOnly_Multi'
  if (isMultiSeat && loneRepublicans) return 'Indep_Openness_ROnly_Multi'

  const incumbentRunning = field.some(
    (c) => c.isIncumbent && (c.party !== null || isNonpartisan),
  )
  const seat = incumbentRunning ? 'Inc' : 'Open'
  if (isMultiSeat) return `Indep_Openness_Multi_${seat}`
  if (loneDemocrats) return `Indep_Openness_DOnly_${seat}`
  if (loneRepublicans) return `Indep_Openness_ROnly_${seat}`
  return `Indep_Openness_Single_${seat}`
}
