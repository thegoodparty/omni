import {
  INCOME_RANGE_MAPPING,
  RoutePayloadTarget,
} from '@goodparty_org/contracts'

// One wording for every absent value on both fact cards, and it describes the
// RECORD rather than the person. Sparseness is the normal condition of the
// voter file — every one of these attributes has a real null case and the
// exploration pack reserves a no-data bucket on every dimension — so a
// canvasser meets this string constantly and it has to be true every time.
//
// "Not on file" is what makes the two presence-only attributes safe to show.
// `veteranStatus` and `businessOwner` are `z.enum(['Yes']).nullable()`: the
// column holds a value meaning yes or nothing at all, so absence is
// indistinguishable from unknown and "No" would be a claim the data cannot
// support — telling a canvasser at the door that someone is not a veteran on
// the strength of an empty column. Applying the same string to every row is
// deliberate: a card where some fields say "Unknown", some say "No" and some
// vanish teaches a reader that absence means something different each time.
// **Splitting one card into two did not split this rule** — the two cards read
// as one profile down the panel, and a reader who met two vocabularies for
// absence across them would learn the wrong lesson from the boundary.
//
// The CRM's person overlay says "Unknown" for the same columns. That is a
// defensible word for the ones that genuinely have an unknown state, but not
// for the two above, and one panel cannot be read two ways at once.
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

const withFallback = (
  facts: Array<{ label: string; value: string | null | undefined }>,
): DemographicFact[] =>
  facts.map(({ label, value }) => ({ label, value: value ?? NOT_ON_FILE }))

// Values in both lists arrive already mapped for display by gp-api
// (`transformToPersonOutput.util.ts`, the same mappers `/v1/contacts` person
// detail uses), so these turn nulls into one string and otherwise print what
// the server decided — inventing a second vocabulary here is how the door
// starts describing a voter's education differently from the CRM.
//
// **The split is the canvas's, not a grouping we chose.** `renderPanel` draws
// three cards where we drew one: registration facts, then support, then the
// personal profile. What follows here is the first and third of those; the
// middle one is `supportPresentation.ts`.

// The canvas's "Voter demographics": who this person is to the voter file,
// which is a different kind of claim from the lifestyle profile below and is
// what a canvasser checks before deciding whether the door is worth the knock.
//
// **Political party moved here out of the sheet's header subtitle**, where it
// used to sit beside the age. The canvas puts the age alone under the name and
// the party in this card, and it is the better place for it: party is a
// voter-file attribute like the two above it, while the subtitle is meant to
// identify the person at a glance.
export const voterDemographicFacts = (
  target: Pick<
    RoutePayloadTarget,
    'registeredVoter' | 'turnoutLikelihood' | 'politicalParty'
  >,
): DemographicFact[] =>
  withFallback([
    { label: 'Registered voter', value: yesNo(target.registeredVoter) },
    // **"Turnout likelihood", not the canvas's "Voter status".**
    // `Voter_Status` holds turnout propensity (Super / Likely / Unreliable /
    // Unlikely), while "voter status" in this industry means active-or-inactive
    // registration — a column we do not have. The canvas's label would name
    // this field as something it isn't.
    { label: 'Turnout likelihood', value: target.turnoutLikelihood },
    { label: 'Political party', value: target.politicalParty },
  ])

// The canvas's "Demographic information": the personal profile, which is
// reference material a canvasser scans mid-conversation rather than something
// they act on.
//
// Two labels are deliberate and load-bearing:
//
// - **"Has children under 18"** is a household Y/N flag, not a count — there is
//   no column for the number of children.
// - **"Estimated household income"** says household, because that is what the
//   column models. Read as a personal income it is a different claim, so this
//   one keeps its wording against the canvas's "Estimated income range".
export const demographicFacts = (
  target: Pick<
    RoutePayloadTarget,
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
  withFallback([
    { label: 'Marital status', value: target.maritalStatus },
    { label: 'Has children under 18', value: target.hasChildrenUnder18 },
    // Presence-only. `veteranStatus` is 'Yes' or null and there is no third
    // branch to write, which is the point — see NOT_ON_FILE above.
    { label: 'Veteran status', value: target.veteranStatus },
    { label: 'Homeowner', value: target.homeowner },
    { label: 'Business owner', value: target.businessOwner },
    { label: 'Level of education', value: target.levelOfEducation },
    {
      label: 'Estimated household income',
      value: incomeRangeLabel(target.estimatedIncomeAmount),
    },
    { label: 'Language', value: target.language },
    { label: 'Ethnicity group', value: target.ethnicityGroup },
  ])
