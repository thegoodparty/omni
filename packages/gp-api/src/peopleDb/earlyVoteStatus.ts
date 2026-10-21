import type { Person } from '@goodparty_org/contracts'

type EarlyVoteStatus = NonNullable<Person['earlyVoteStatus']>

// The mart writes Early_Vote_Status in sentence case ('Very likely'); the
// product speaks Title Case ('Very Likely'), like its other multi-word person
// values. The two meet here, in both directions, so the contract, the filter
// values and the labels never see the mart's spelling. Lookups ignore case so a
// future mart rebuild in Title Case keeps working without a change here. The
// CSV download copies the column raw and still says 'Very likely'.
const MART_TO_PRODUCT: Record<string, EarlyVoteStatus | 'Unknown'> = {
  'very likely': 'Very Likely',
  likely: 'Likely',
  unlikely: 'Unlikely',
  'very unlikely': 'Very Unlikely',
  unknown: 'Unknown',
}

const PRODUCT_TO_MART: Record<string, string> = {
  'very likely': 'Very likely',
  likely: 'Likely',
  unlikely: 'Unlikely',
  'very unlikely': 'Very unlikely',
  unknown: 'Unknown',
}

// Person-payload direction. The 'Unknown' sentinel and anything unrecognized
// map to null, the same contract as voterStatus.
export const earlyVoteStatusFromMart = (
  value: string | null | undefined,
): EarlyVoteStatus | null => {
  const mapped = value ? MART_TO_PRODUCT[value.toLowerCase()] : undefined
  return mapped && mapped !== 'Unknown' ? mapped : null
}

// Filter direction: a product value as the column stores it. An unrecognized
// value passes through untouched, so it matches nothing rather than something
// else.
export const earlyVoteStatusToMart = (value: string): string =>
  PRODUCT_TO_MART[value.toLowerCase()] ?? value
