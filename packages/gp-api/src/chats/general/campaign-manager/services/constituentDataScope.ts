import type { MandatoryFilter } from '@/llm/tools/constituentSql.validator'
import type {
  AdvertisedDimension,
  ConstituentDataScope,
} from '@/llm/tools/queryConstituentData.tool'
import { partyProvenanceForState } from '@/peopleDb/partySource'
import type { PeopleDataset } from '@/peopleDb/services/peopleDataset.service'
import {
  buildContactOverlayTable,
  type ConstituentTableConfig,
} from '../../chief-of-staff/services/constituentDataScope'
import { WIN_AGENT_VOTER_DIMENSIONS } from './constituentDimensions.winAgentVoters'
import { WIN_AGENT_VOTER_SUGGESTED_DIMENSIONS } from './constituentSuggestedDimensions.winAgentVoters'

// Suppression floor for aggregate cells, same as Serve: counts below this are
// dropped before any result reaches the model (anti-differencing backstop).
const CONSTITUENT_MIN_CELL_SIZE = 100

// App-layer allowlist for the Win mart. The approved surface is
// goodparty_data_catalog.mart_win_agents.win_agent_voters: a sibling of the
// Serve mart that removes PII only and deliberately retains partisan and
// commercial fields for campaign targeting (see the spec in
// scratch/campaign-manager/win-constituent-data-spec.md). The table is the
// allowlist; regenerate the dimensions file when its schema changes.
export const WIN_CONSTITUENT_TABLES: ConstituentTableConfig[] = [
  {
    table: 'win_agent_voters',
    dimensions: WIN_AGENT_VOTER_DIMENSIONS,
  },
]

// Identity backstop only. Unlike Serve there is NO partisan entry here:
// the Win mart retains party/ideology columns by design and the product
// decision (2026-07-06) is that campaigns may query and be offered them.
// These identity names are already absent from the mart (PII removed
// upstream, LALVOTERID hashed to voter_key) — pure defense-in-depth.
const FORBIDDEN_COLUMNS = new Set([
  'name',
  'first_name',
  'last_name',
  'address',
  'phone',
  'email',
  'voter_id',
])

// The columns the campaign's imported-contact overlay adds. They are not in
// the mart, so they are allowed only when the overlay join is swapped in.
const CONTACT_OVERLAY_DIMENSIONS: AdvertisedDimension[] = [
  {
    name: 'on_uploaded_list',
    label: 'On a contact list the campaign uploaded (values true or false)',
  },
  {
    name: 'has_email',
    label:
      'Has an email address from a contact list the campaign uploaded (values true or false)',
  },
]

// The generated catalog words the party dimensions as registrations, and a
// label is the model's only meaning surface. Where the state records no
// party registration the labels say the vendor assigned the value instead
// (the query tool's description carries the vendor's account of this
// state), and where the file holds no party information at all the
// party-change flag is not advertised: the column seed records that L2
// leaves it empty there.
const withPartySource = (
  dimensions: AdvertisedDimension[],
  state: string | null | undefined,
): AdvertisedDimension[] => {
  const party = partyProvenanceForState(state)
  if (!party || party.source === 'registration') return dimensions
  return dimensions.flatMap((dimension) => {
    switch (dimension.name) {
      case 'Parties_Description':
        return [
          {
            name: dimension.name,
            label: 'Party as the vendor assigns it, not a registration',
          },
        ]
      case 'Residence_HHParties_Description':
        return [
          {
            name: dimension.name,
            label:
              'Household party mix, built from the same assigned party ' +
              'values, not registrations',
          },
        ]
      case 'VoterParties_Change_Changed_Party':
        return party.source === 'modeled'
          ? []
          : [
              {
                name: dimension.name,
                label: 'Has changed party, as the vendor assigns it',
              },
            ]
      default:
        return [dimension]
    }
  })
}

export const buildWinConstituentDataScope = (
  districtFilters: MandatoryFilter[],
  tables: ConstituentTableConfig[],
  state?: string | null,
  peopleDataset: PeopleDataset = { base: 'voters' },
): ConstituentDataScope => {
  const party = partyProvenanceForState(state)
  const overlayOrgSlug = peopleDataset.overlayOrgSlug
  const advertised = withPartySource(
    WIN_AGENT_VOTER_SUGGESTED_DIMENSIONS,
    state,
  )
  return {
    allowedTables: new Set(tables.map((t) => t.table)),
    allowedDimensions: new Set([
      ...tables.flatMap((t) => t.dimensions),
      ...(overlayOrgSlug === undefined
        ? []
        : CONTACT_OVERLAY_DIMENSIONS.map((d) => d.name)),
    ]),
    advertisedDimensions:
      overlayOrgSlug === undefined
        ? advertised
        : [...advertised, ...CONTACT_OVERLAY_DIMENSIONS],
    forbiddenColumns: FORBIDDEN_COLUMNS,
    mandatoryFilters: districtFilters,
    minCellSize: CONSTITUENT_MIN_CELL_SIZE,
    partisanQueriesAllowed: true,
    audienceNoun: 'voter',
    partyNote: party && party.source !== 'registration' ? party.sentence : null,
    peopleDataset,
    contactOverlayTable:
      overlayOrgSlug === undefined || tables[0] === undefined
        ? undefined
        : buildContactOverlayTable({
            schema: 'mart_win_agents',
            table: tables[0].table,
            view:
              process.env.WIN_AGENT_CONTACT_OVERLAY_VIEW ||
              'win_agent_contact_overlay',
            districtFilters,
            organizationSlug: overlayOrgSlug,
          }),
  }
}
