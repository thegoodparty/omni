import type { USState } from './voter.types'

// How L2 fills Parties_Description in each state, from L2's own account,
// "State by State Partisanship (Party)", September 2024:
// https://www.l2-data.com/wp-content/uploads/2024/09/State-by-State-Partisanship-Party.pdf
//
// In a `registration` state the value is the party the voter registered
// with, as the state reports it. In a `primary_ballot` state nobody
// registers by party: L2 assigns one from the most recent partisan primary
// ballot the state recorded, or from partisan contributions or office
// holding, and models the rest. In a `modeled` state the voter file carries
// no party information at all and L2 models every value from commercial
// data plus a limited amount of contribution and office-holding records.
//
// The gp-data-platform column seed (l2_column_classification.csv) says 17
// states are modeled and points at the same vendor document; the document
// lists 19 states with no party registration (11 primary-ballot and 8
// modeled) and governs here, being the newer and more specific source. The
// seed also records that Residence_HHParties_Description inherits this
// source and that VoterParties_Change_Changed_Party is not populated where
// party is modeled.
export type PartySource = 'registration' | 'primary_ballot' | 'modeled'

const STATES: Record<USState, { name: string; source: PartySource }> = {
  AL: { name: 'Alabama', source: 'modeled' },
  AK: { name: 'Alaska', source: 'registration' },
  AZ: { name: 'Arizona', source: 'registration' },
  AR: { name: 'Arkansas', source: 'registration' },
  CA: { name: 'California', source: 'registration' },
  CO: { name: 'Colorado', source: 'registration' },
  CT: { name: 'Connecticut', source: 'registration' },
  DC: { name: 'District of Columbia', source: 'registration' },
  DE: { name: 'Delaware', source: 'registration' },
  FL: { name: 'Florida', source: 'registration' },
  GA: { name: 'Georgia', source: 'primary_ballot' },
  HI: { name: 'Hawaii', source: 'modeled' },
  ID: { name: 'Idaho', source: 'registration' },
  IL: { name: 'Illinois', source: 'primary_ballot' },
  IN: { name: 'Indiana', source: 'primary_ballot' },
  IA: { name: 'Iowa', source: 'registration' },
  KS: { name: 'Kansas', source: 'registration' },
  KY: { name: 'Kentucky', source: 'registration' },
  LA: { name: 'Louisiana', source: 'registration' },
  ME: { name: 'Maine', source: 'registration' },
  MD: { name: 'Maryland', source: 'registration' },
  MA: { name: 'Massachusetts', source: 'registration' },
  MI: { name: 'Michigan', source: 'primary_ballot' },
  MN: { name: 'Minnesota', source: 'modeled' },
  MS: { name: 'Mississippi', source: 'primary_ballot' },
  MO: { name: 'Missouri', source: 'modeled' },
  MT: { name: 'Montana', source: 'modeled' },
  NE: { name: 'Nebraska', source: 'registration' },
  NV: { name: 'Nevada', source: 'registration' },
  NH: { name: 'New Hampshire', source: 'registration' },
  NJ: { name: 'New Jersey', source: 'registration' },
  NM: { name: 'New Mexico', source: 'registration' },
  NY: { name: 'New York', source: 'registration' },
  NC: { name: 'North Carolina', source: 'registration' },
  ND: { name: 'North Dakota', source: 'modeled' },
  OH: { name: 'Ohio', source: 'primary_ballot' },
  OK: { name: 'Oklahoma', source: 'registration' },
  OR: { name: 'Oregon', source: 'registration' },
  PA: { name: 'Pennsylvania', source: 'registration' },
  RI: { name: 'Rhode Island', source: 'registration' },
  SC: { name: 'South Carolina', source: 'primary_ballot' },
  SD: { name: 'South Dakota', source: 'registration' },
  TN: { name: 'Tennessee', source: 'primary_ballot' },
  TX: { name: 'Texas', source: 'primary_ballot' },
  UT: { name: 'Utah', source: 'registration' },
  VT: { name: 'Vermont', source: 'modeled' },
  VA: { name: 'Virginia', source: 'primary_ballot' },
  WA: { name: 'Washington', source: 'primary_ballot' },
  WV: { name: 'West Virginia', source: 'registration' },
  WI: { name: 'Wisconsin', source: 'modeled' },
  WY: { name: 'Wyoming', source: 'registration' },
}

const isUSState = (value: string): value is USState =>
  Object.hasOwn(STATES, value)

export interface PartyProvenance {
  state: USState
  stateName: string
  source: PartySource
  // The CRM filter catalog's vocabulary for the same fact: a registration
  // is a recorded fact on the file, anything else is an estimate.
  provenance: 'observed' | 'modeled'
  // One sentence on where the value comes from, in the vendor's own terms
  // but naming it only as the vendor: the product does not name L2 to the
  // model or to candidates.
  sentence: string
}

const sentenceFor = (name: string, source: PartySource): string => {
  switch (source) {
    case 'registration':
      return (
        `${name} voters register by party, and the state voter file ` +
        'reports that choice.'
      )
    case 'primary_ballot':
      return (
        `${name} voters do not register by party. The voter file vendor ` +
        "assigns each voter's party from partisan primary participation " +
        'records where it has them, and models the rest.'
      )
    case 'modeled':
      return (
        `${name} provides no party information in its voter file. The ` +
        "voter file vendor models every voter's party from commercial " +
        'data, with a limited amount of partisan-contribution and ' +
        'office-holding records.'
      )
  }
}

// Null for an unknown or missing state: callers keep their state-free
// wording rather than claim a source they cannot name.
export const partyProvenanceForState = (
  state: string | null | undefined,
): PartyProvenance | null => {
  const code = state?.trim().toUpperCase() ?? ''
  if (!isUSState(code)) return null
  const { name, source } = STATES[code]
  return {
    state: code,
    stateName: name,
    source,
    provenance: source === 'registration' ? 'observed' : 'modeled',
    sentence: sentenceFor(name, source),
  }
}

export const partySourceForState = (
  state: string | null | undefined,
): PartySource | null => partyProvenanceForState(state)?.source ?? null
