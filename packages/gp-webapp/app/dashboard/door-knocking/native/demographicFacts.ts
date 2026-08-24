import {
  INCOME_RANGE_MAPPING,
  RoutePayloadTarget,
} from '@goodparty_org/contracts'

// One wording for every absent value on the demographic card, and it describes
// the RECORD rather than the person. Sparseness is the normal condition of the
// voter file — every one of the eleven attributes has a real null case and the
// exploration pack reserves a no-data bucket on every dimension — so a
// canvasser meets this string constantly and it has to be true every time.
//
// "Not on file" is what makes the two presence-only attributes safe to show.
// `veteranStatus` and `businessOwner` are `z.enum(['Yes']).nullable()`: the
// column holds a value meaning yes or nothing at all, so absence is
// indistinguishable from unknown and "No" would be a claim the data cannot
// support — telling a canvasser at the door that someone is not a veteran on
// the strength of an empty column. Applying the same string to all eleven is
// deliberate: a card where some fields say "Unknown", some say "No" and some
// vanish teaches a reader that absence means something different each time.
//
// The CRM's person overlay says "Unknown" for the same columns. That is a
// defensible word for the nine that genuinely have an unknown state, but not
// for the two above, and one card cannot be read two ways at once.
export const NOT_ON_FILE = 'Not on file'

// `Estimated_Income_Amount_Int` is a modelled figure, so it is bucketed rather
// than printed to the dollar — the precision would imply a measurement nobody
// took. Buckets are `INCOME_RANGE_MAPPING` from contracts, the same vocabulary
// the CRM's income filter offers, so a candidate who lists on "$50k - $75k"
// meets that exact label again at the door.
//
// Zero reads as absent, following the CRM overlay's own `getIncomeBucket`: a
// modelled household income of exactly $0 is a placeholder far more often than
// a finding, and bucketing it into "Under $25k" would state one.
export const incomeRangeLabel = (
  amount: number | null | undefined,
): string | null => {
  if (!amount || amount < 0) return null
  const match = Object.entries(INCOME_RANGE_MAPPING).find(
    ([, range]) =>
      amount >= range.min && (range.max === null || amount <= range.max),
  )
  return match?.[0] ?? null
}

export interface DemographicFact {
  label: string
  value: string
}

// `== null` deliberately, catching undefined as well as null. These fields are
// optional on the route payload so a route snapshotted offline before they
// shipped still parses, which means "absent" is a real runtime state on a phone
// that cannot refetch — and nothing parses this payload in the webapp, so the
// key is simply missing rather than filled in. A bare `value ? 'Yes' : 'No'`
// makes undefined false and prints "No" against `registeredVoter` for every one
// of those snapshots: a fact stated about a named voter on no data at all.
const yesNo = (value: boolean | null | undefined): string | null =>
  value == null ? null : value ? 'Yes' : 'No'

// The eleven attributes, in the order product asked for them. Values arrive
// already mapped for display by gp-api (`transformToPersonOutput.util.ts`, the
// same mappers `/v1/contacts` person detail uses), so this turns nulls into one
// string and otherwise prints what the server decided — inventing a second
// vocabulary here is how the door starts describing a voter's education
// differently from the CRM.
//
// Three labels are deliberate and load-bearing:
//
// - **"Turnout likelihood"**, not the prototype's "Voter status". `Voter_Status`
//   holds turnout propensity (Super / Likely / Unreliable / Unlikely), while
//   "voter status" in this industry means active-or-inactive registration. The
//   prototype's label would name this as something it isn't.
// - **"Has children under 18"** is a household Y/N flag, not a count — there is
//   no column for the number of children.
// - **"Estimated household income"** says household, because that is what the
//   column models. Read as a personal income it is a different claim.
export const demographicFacts = (
  target: Pick<
    RoutePayloadTarget,
    | 'registeredVoter'
    | 'turnoutLikelihood'
    | 'maritalStatus'
    | 'hasChildrenUnder18'
    | 'veteranStatus'
    | 'homeowner'
    | 'businessOwner'
    | 'levelOfEducation'
    | 'estimatedIncomeAmount'
    | 'language'
    | 'ethnicityGroup'
  >,
): DemographicFact[] =>
  [
    { label: 'Registered voter', value: yesNo(target.registeredVoter) },
    { label: 'Turnout likelihood', value: target.turnoutLikelihood },
    { label: 'Marital status', value: target.maritalStatus },
    { label: 'Has children under 18', value: target.hasChildrenUnder18 },
    // Presence-only. `veteranStatus` is 'Yes' or null and there is no third
    // branch to write, which is the point — see NOT_ON_FILE above.
    { label: 'Veteran', value: target.veteranStatus },
    { label: 'Homeowner', value: target.homeowner },
    { label: 'Business owner', value: target.businessOwner },
    { label: 'Level of education', value: target.levelOfEducation },
    {
      label: 'Estimated household income',
      value: incomeRangeLabel(target.estimatedIncomeAmount),
    },
    { label: 'Language', value: target.language },
    { label: 'Ethnicity', value: target.ethnicityGroup },
  ].map(({ label, value }) => ({ label, value: value ?? NOT_ON_FILE }))
