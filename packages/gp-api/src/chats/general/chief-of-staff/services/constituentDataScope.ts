import type { MandatoryFilter } from '@/llm/tools/constituentSql.validator'
import type {
  AdvertisedDimension,
  ConstituentDataScope,
} from '@/llm/tools/queryConstituentData.tool'
import type { PeopleDataset } from '@/peopleDb/services/peopleDataset.service'
import { SERVE_AGENT_VOTER_DIMENSIONS } from './constituentDimensions.serveAgentVoters'
import { SERVE_AGENT_VOTER_SUGGESTED_DIMENSIONS } from './constituentSuggestedDimensions.serveAgentVoters'

// Suppression floor for aggregate cells. Counts below this are dropped before
// any result reaches the model (anti-differencing backstop).
const CONSTITUENT_MIN_CELL_SIZE = 100

export interface ConstituentTableConfig {
  table: string
  dimensions: string[]
}

// App-layer allowlist (lever 1): a deliberate, code-reviewed security control
// kept in code (typed, reviewed, covered by bypass tests) NOT env. The approved
// surface is the purpose-built serve_agent_voters mart, curated upstream by the
// research + product teams: one pseudonymous row per voter (voter_key is a
// SHA-256 hash, never the raw L2 id), modeled issue scores, and geography. The
// table is the allowlist — columns are added/removed there, and the dimension
// list mirrors it (regenerate constituentDimensions.serveAgentVoters.ts when the
// schema changes). Aggregate-only safety still comes from the SQL validator,
// mandatory district filters, the forbidden-column backstop, and the cell-size
// floor below.
export const CONSTITUENT_TABLES: ConstituentTableConfig[] = [
  {
    table: 'serve_agent_voters',
    dimensions: SERVE_AGENT_VOTER_DIMENSIONS,
  },
]

export type ConstituentTablesByDataset = Record<
  PeopleDataset['base'],
  ConstituentTableConfig[]
>

// Chosen per chat turn from PeopleDatasetService. serve_agent_constituents is
// a superset of serve_agent_voters (every voter row unchanged, plus adult
// residents who are not registered to vote) with the same column names, so
// it carries the same allowlist. Its extra columns stay unqueryable.
export const CONSTITUENT_TABLES_BY_DATASET: ConstituentTablesByDataset = {
  voters: CONSTITUENT_TABLES,
  constituents: [
    {
      table: 'serve_agent_constituents',
      dimensions: SERVE_AGENT_VOTER_DIMENSIONS,
    },
  ],
}

// WHERE the approved surface lives, beside WHAT it is. Two modules build a
// provider against this pair (chief-of-staff and priority-flow) and the
// judge's data-version resolver has to query the very table the tool reads,
// so a third and fourth copy of the literals is how one of them ends up
// pointing at a different table than the one under test. The catalog is the
// same one peopleDb/databricks/peopleDbx.config.ts names; only the schema
// differs, because this mart is curated for the Serve agents.
export const CONSTITUENT_CATALOG = 'goodparty_data_catalog'
export const CONSTITUENT_SCHEMA = 'mart_serve_agents'

// Hard legal line: these columns must NEVER appear in any clause. App-side
// defensive backstop layered on top of the warehouse credential's column
// denies. These are best-effort guesses at the names.
// TODO(data-team): confirm the EXACT column names in the approved table so the
// forbidden list matches reality (the warehouse grant is the primary control).
const FORBIDDEN_COLUMNS = new Set([
  'party',
  'partisan_lean',
  'registered_party',
  'name',
  'first_name',
  'last_name',
  'address',
  'phone',
  'email',
  'voter_id',
])

// The columns the org's imported-contact overlay adds. They are not in the
// mart, so they are allowed only when the overlay join is swapped in.
const CONTACT_OVERLAY_DIMENSIONS: AdvertisedDimension[] = [
  {
    name: 'on_uploaded_list',
    label: 'On a contact list the office uploaded (values true or false)',
  },
  {
    name: 'has_email',
    label:
      'Has an email address from a contact list the office uploaded (values true or false)',
  },
]

const OVERLAY_IDENTIFIER_RE = /^[A-Za-z0-9_]+$/

// Backslash is Spark's string escape; a doubled quote would concatenate two
// literals instead.
const stringLiteral = (value: string): string =>
  `'${value.replace(/[\\']/g, '\\$&')}'`

// The table FULL OUTER JOIN the org's imported contacts, filtered to the
// district on the table side. Every row carries the district filter's own
// values, so the mandatory filter the validator demanded keeps the people
// only an import added, who have no row in the mart.
const contactOverlayTable = (
  table: string,
  districtFilters: MandatoryFilter[],
  organizationSlug: string,
): string => {
  const view =
    process.env.SERVE_AGENT_CONTACT_OVERLAY_VIEW ||
    'serve_agent_contact_overlay'
  const identifiers = [table, view, ...districtFilters.map((f) => f.column)]
  const unsafe = identifiers.find((name) => !OVERLAY_IDENTIFIER_RE.test(name))
  if (unsafe !== undefined) {
    throw new Error(`Refusing to inline the identifier ${unsafe}`)
  }
  const scope = new Map<string, MandatoryFilter>()
  for (const filter of districtFilters) {
    scope.set(filter.column.toLowerCase(), filter)
  }
  const filters = [...scope.values()]
  const qualified = (name: string) =>
    `${CONSTITUENT_CATALOG}.${CONSTITUENT_SCHEMA}.${name}`
  const projection = [
    `b.* EXCEPT (\`voter_key\`, ${filters.map((f) => `\`${f.column}\``).join(', ')})`,
    'coalesce(b.`voter_key`, o.`voter_key`) AS `voter_key`',
    ...filters.map((f) => `${stringLiteral(f.value)} AS \`${f.column}\``),
    'coalesce(o.`on_uploaded_list`, false) AS `on_uploaded_list`',
    'coalesce(o.`has_email`, false) AS `has_email`',
  ].join(', ')
  const base =
    `SELECT * FROM ${qualified(table)} WHERE ` +
    filters
      .map((f) => `\`${f.column}\` = ${stringLiteral(f.value)}`)
      .join(' AND ')
  const overlay =
    `SELECT * FROM ${qualified(view)}` +
    ` WHERE organization_slug = ${stringLiteral(organizationSlug)}`
  return (
    `(SELECT ${projection} FROM (${base}) b` +
    ` FULL OUTER JOIN (${overlay}) o ON o.\`voter_key\` = b.\`voter_key\`)`
  )
}

export const buildConstituentDataScope = (
  districtFilters: MandatoryFilter[],
  tables: ConstituentTableConfig[],
  peopleDataset: PeopleDataset,
): ConstituentDataScope => ({
  allowedTables: new Set(tables.map((t) => t.table)),
  allowedDimensions: new Set([
    ...tables.flatMap((t) => t.dimensions),
    ...(peopleDataset.overlayOrgSlug === undefined
      ? []
      : CONTACT_OVERLAY_DIMENSIONS.map((d) => d.name)),
  ]),
  advertisedDimensions:
    peopleDataset.overlayOrgSlug === undefined
      ? SERVE_AGENT_VOTER_SUGGESTED_DIMENSIONS
      : [
          ...SERVE_AGENT_VOTER_SUGGESTED_DIMENSIONS,
          ...CONTACT_OVERLAY_DIMENSIONS,
        ],
  forbiddenColumns: FORBIDDEN_COLUMNS,
  mandatoryFilters: districtFilters,
  minCellSize: CONSTITUENT_MIN_CELL_SIZE,
  audienceNoun: 'constituent',
  // The serve catalog carries meaning labels, value tokens, and the coverage /
  // off-center marks that hsScoreSemantics refers to (verified against
  // serve_agent_voters, 2026-08-04).
  catalogCarriesScoreMarks: true,
  peopleDataset,
  contactOverlayTable:
    peopleDataset.overlayOrgSlug === undefined || tables[0] === undefined
      ? undefined
      : contactOverlayTable(
          tables[0].table,
          districtFilters,
          peopleDataset.overlayOrgSlug,
        ),
})
