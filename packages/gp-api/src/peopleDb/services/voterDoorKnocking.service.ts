import { BadRequestException, Injectable } from '@nestjs/common'
import {
  DoorKnockingDemographicsShape,
  DoorKnockingEvaluateResponse,
  DoorKnockingEvaluateResponseSchema,
  DoorKnockingResidentsResponse,
  DoorKnockingResidentsResponseSchema,
  DoorKnockingResidentTarget,
} from '@goodparty_org/contracts'
import { Prisma } from '../../generated/people-prisma'
import { createPeopleDbBase, PEOPLE_MODELS } from '../peopleDbBase.util'
import { DistrictService } from './district.service'
import { DATABASE_SCHEMA } from './voterQuery.service'
import { buildDoorKnockingAddressKeySql } from '../utils/doorKnockingAddressKey.util'
import { buildVoterWhereSql } from '../utils/buildVoterWhereSql.util'
import { resolveDistrict } from '../utils/resolveDistrict.util'
import {
  mapAge,
  mapBusinessOwner,
  mapEducation,
  mapEthnicity,
  mapHomeowner,
  mapLanguage,
  mapMaritalStatus,
  mapPoliticalParty,
  mapPresenceOfChildren,
  mapVeteranStatus,
  mapVoterStatus,
} from '../utils/transformToPersonOutput.util'
import { FilterData } from '../schemas/filters.schema'
import {
  DoorKnockingEvaluateDTO,
  DoorKnockingResidentsDTO,
} from '../schemas/doorKnocking.schema'
import { buildBboxSql } from '../utils/bboxSql.util'
import { runUnderStatementTimeout } from '../utils/statementTimeout.util'

const VOTER_TABLE = Prisma.raw(`"${DATABASE_SCHEMA}"."Voter"`)
const DV_TABLE = Prisma.raw(`"${DATABASE_SCHEMA}"."DistrictVoter"`)

const DV_JOIN = Prisma.sql`JOIN ${DV_TABLE} dv
  ON v."State" = dv."State" AND v."id" = dv."voter_id"`

// v1 quality gate: rooftop-geocoded rows only (>90% of the file). Widening
// to more accuracy tiers is a WHERE change here, not a contract change.
const ROOFTOP_ONLY = Prisma.sql`v."Residence_Addresses_LatLongAccuracy" = 'GeoMatchRooftop'`

// ADR 0007 and ADR 0008. An unconditional conjunct alongside ROOFTOP_ONLY
// rather than an id-override on a filter clause: the override slots hang off a
// specific filter (voterStatus, contacts-made) and vanish when that filter is
// absent, which is the one failure mode a suppression must not have. Both
// do-not-knock and not-a-voter arrive through this one clause — they differ in
// what someone said at the door, not in what the query has to do about it.
const excludeIdsSql = (personIds: string[]) =>
  Prisma.sql`v."id" != ALL(${personIds}::uuid[])`

const EMPTY_FILTERS: FilterData = {
  filters: [],
  filterValues: {},
  filterOperators: {},
}

type EvaluateRow = {
  id: string
  firstName: string | null
  lastName: string | null
  lat: number
  lng: number
  addressKey: string
  displayAddress: string
}

type ResidentRow = {
  id: string
  firstName: string | null
  lastName: string | null
  Age: string | null
  Age_Int: number | null
  Parties_Description: string | null
  cellPhone: string | null
  landline: string | null
  addressKey: string
  // The demographic profile, mapped for display by the same functions
  // /v1/contacts person detail uses. Raw column names deliberately, matching
  // the Age/Parties_Description rows above — the mapper signatures take the
  // file's own vocabulary, and aliasing here would put the translation in two
  // places.
  registered: boolean
  Voter_Status: string | null
  Marital_Status: string | null
  Presence_Of_Children: string | null
  Veteran_Status: string | null
  Homeowner_Probability_Model: string | null
  Business_Owner: string | null
  Education_Of_Person: string | null
  Estimated_Income_Amount_Int: number | null
  Language_Code: string | null
  EthnicGroups_EthnicGroup1Desc: string | null
}

// The eleven attributes the door shows for a target, through the same display
// mappers `/v1/contacts` person detail already uses — the mapping is decided
// there, and a second interpretation of `Home Owner` or `Inferred Married`
// living here is how the door and the CRM start describing one voter two ways.
//
// Every field has a real null case and sparseness is the normal condition of
// this file, not an edge: the caller renders a null identically for all eleven
// rather than letting some vanish and others read "Unknown".
const mapDemographics = (
  row: ResidentRow,
): Pick<
  DoorKnockingResidentTarget,
  keyof typeof DoorKnockingDemographicsShape
> => ({
  registeredVoter: row.registered,
  // `Voter_Status` is turnout propensity, not registration activity — see the
  // contract, which renames it on the way out for exactly that reason. The
  // file's `Unknown` sentinel maps to null rather than being carried through.
  turnoutLikelihood: mapVoterStatus(row.Voter_Status),
  maritalStatus: mapMaritalStatus(row.Marital_Status),
  hasChildrenUnder18: mapPresenceOfChildren(row.Presence_Of_Children),
  // Presence-only, both of these: the mappers return 'Yes' or null, because
  // the columns hold a value meaning yes or nothing at all. There is no "No"
  // to emit and the contract's `z.enum(['Yes'])` is what enforces it.
  veteranStatus: mapVeteranStatus(row.Veteran_Status),
  businessOwner: mapBusinessOwner(row.Business_Owner),
  homeowner: mapHomeowner(row.Homeowner_Probability_Model),
  levelOfEducation: mapEducation(row.Education_Of_Person),
  // The raw amount; the door buckets it through INCOME_RANGE_MAPPING at
  // render, so a modelled figure is never printed to the dollar.
  estimatedIncomeAmount: row.Estimated_Income_Amount_Int,
  // No data stays null, exactly as `politicalParty` above does and unlike
  // `mapLanguage`'s own no-value branch, which returns 'Other'. At the door
  // that would tell a canvasser this person speaks something other than
  // English or Spanish on the strength of an empty column. A present but
  // unrecognized value IS a real fact and still maps to 'Other'.
  language: row.Language_Code ? mapLanguage(row.Language_Code) : null,
  ethnicityGroup: mapEthnicity(row.EthnicGroups_EthnicGroup1Desc),
})

@Injectable()
export class VoterDoorKnockingService extends createPeopleDbBase(
  PEOPLE_MODELS.Voter,
) {
  constructor(private readonly districtService: DistrictService) {
    super()
  }

  // Statewide districts take the voter-only path: DistrictVoter has no rows
  // for the whole-state pseudo-district, so the join must be dropped and the
  // query scoped by State alone (same rule as findPeople).
  private async resolveScope(districtId: string) {
    const resolved = await resolveDistrict(this.districtService, {
      districtId,
    })
    const effectiveDistrictId = resolved.useVoterOnlyPath ? null : districtId
    return {
      state: resolved.state,
      effectiveDistrictId,
      joinClause: effectiveDistrictId ? DV_JOIN : Prisma.empty,
    }
  }

  async evaluate(
    dto: DoorKnockingEvaluateDTO,
  ): Promise<DoorKnockingEvaluateResponse> {
    const { state, effectiveDistrictId, joinClause } = await this.resolveScope(
      dto.districtId,
    )
    const whereClause = buildVoterWhereSql({
      state,
      districtId: effectiveDistrictId,
      filters: dto.filters,
      extraConditions: [
        ROOFTOP_ONLY,
        buildBboxSql(dto.bbox),
        // Its own conjunct rather than folded into idOverrides below: those
        // ride buildVoterFiltersSql, which contributes nothing when the turf's
        // filter is empty, and a suppression has to hold regardless of what
        // the candidate filtered on.
        //
        // Omitted when empty: an `!= ALL('{}')` is always true, but adding the
        // clause anyway would change the SQL of every request that has nobody
        // to suppress.
        ...(dto.excludePersonIds?.length
          ? [excludeIdsSql(dto.excludePersonIds)]
          : []),
      ],
      idOverrides: dto.idOverrides,
      contactsMadeIdOverrides: dto.contactsMadeIdOverrides,
    })

    // maxPeople is a guard, not pagination: over the cap the whole request
    // fails, so an oversized polygon can't silently truncate to a wrong
    // roster or stream a whole voter file. LIMIT +1 detects the overflow
    // without counting.
    const rows = await runUnderStatementTimeout<EvaluateRow>(
      this.client,
      Prisma.sql`
      SELECT v."id",
        v."FirstName" AS "firstName",
        v."LastName" AS "lastName",
        v."Residence_Addresses_Latitude"::float8 AS "lat",
        v."Residence_Addresses_Longitude"::float8 AS "lng",
        ${buildDoorKnockingAddressKeySql('v')} AS "addressKey",
        COALESCE(v."Residence_Addresses_AddressLine", '') AS "displayAddress"
      FROM ${VOTER_TABLE} v
      ${joinClause}
      ${whereClause}
      LIMIT ${dto.maxPeople + 1}`,
      this.logger,
      'Evaluating this turf took too long. Shrink the polygon or narrow the ' +
        'filters and try again.',
    )

    if (rows.length > dto.maxPeople) {
      throw new BadRequestException(
        `Turf evaluation matched more than ${dto.maxPeople} people — ` +
          'shrink the polygon or narrow the filters',
      )
    }

    return DoorKnockingEvaluateResponseSchema.parse({ people: rows })
  }

  async residents(
    dto: DoorKnockingResidentsDTO,
  ): Promise<DoorKnockingResidentsResponse> {
    const { state, effectiveDistrictId, joinClause } = await this.resolveScope(
      dto.districtId,
    )
    const whereClause = buildVoterWhereSql({
      state,
      districtId: effectiveDistrictId,
      filters: EMPTY_FILTERS,
      extraConditions: [
        // ROOFTOP_ONLY keeps the population in parity with evaluate — the
        // cap below is sized against the rooftop-only roster, and a unit's
        // non-rooftop rows would inflate rows toward a spurious rejection.
        ROOFTOP_ONLY,
        Prisma.sql`${buildDoorKnockingAddressKeySql('v')} = ANY(${dto.addressKeys}::text[])`,
      ],
    })

    const residentsCap = dto.targetPersonIds.length * 10
    // The demographic columns below are a wider PROJECTION and nothing else.
    // The address-key predicate, the LIMIT and the reject-rather-than-truncate
    // guard are deliberately untouched: this is the module's fragile query —
    // its predicate is non-sargable with no matching index, which is why it is
    // the one that tips over first when people-db is degraded (see
    // peopleDb/AGENTS.md). That cost lives in the scan, and which columns come
    // back does not move it; every column here is read off rows the scan
    // already had to visit.
    //
    // `registered` is computed rather than selected raw — the same definition
    // of the word the exploration-map pack uses (voterPack.service.ts), and it
    // keeps a state voter id out of a payload with no use for one.
    const rows = await runUnderStatementTimeout<ResidentRow>(
      this.client,
      Prisma.sql`
      SELECT v."id",
        v."FirstName" AS "firstName",
        v."LastName" AS "lastName",
        v."Age",
        v."Age_Int",
        v."Parties_Description",
        v."VoterTelephones_CellPhoneFormatted" AS "cellPhone",
        v."VoterTelephones_LandlineFormatted" AS "landline",
        (v."StateVoterID" IS NOT NULL) AS "registered",
        v."Voter_Status",
        v."Marital_Status",
        v."Presence_Of_Children",
        v."Veteran_Status",
        v."Homeowner_Probability_Model",
        v."Business_Owner",
        v."Education_Of_Person",
        v."Estimated_Income_Amount_Int",
        v."Language_Code",
        v."EthnicGroups_EthnicGroup1Desc",
        ${buildDoorKnockingAddressKeySql('v')} AS "addressKey"
      FROM ${VOTER_TABLE} v
      ${joinClause}
      ${whereClause}
      LIMIT ${residentsCap + 1}`,
      this.logger,
      'Loading residents for this route took too long. Try again in a moment.',
    )

    // Mirrors evaluate's guard: reject rather than silently truncate — a
    // truncated response would serve wrong rosters. The cap is generous
    // (unit-level addressKeys hold household-sized populations).
    if (rows.length > residentsCap) {
      throw new BadRequestException(
        'Residents lookup exceeded the expected population for this route',
      )
    }

    const targetIds = new Set<string>(dto.targetPersonIds)
    const byAddress = new Map<
      string,
      DoorKnockingResidentsResponse['addresses'][number]
    >()
    for (const row of rows) {
      let address = byAddress.get(row.addressKey)
      if (!address) {
        address = {
          addressKey: row.addressKey,
          targets: [],
          otherResidents: [],
        }
        byAddress.set(row.addressKey, address)
      }
      if (targetIds.has(row.id)) {
        address.targets.push({
          personId: row.id,
          firstName: row.firstName,
          lastName: row.lastName,
          age: mapAge(row),
          // No party data (null/empty) stays null — unlike /v1/people
          // output, which collapses it to 'Other'. A non-empty unrecognized
          // value (Green, Libertarian, …) IS a real registration and maps
          // to 'Other' deliberately; the ?? null only narrows the mapper's
          // optional return type.
          politicalParty: row.Parties_Description
            ? (mapPoliticalParty(row.Parties_Description) ?? null)
            : null,
          // Blank-vs-NULL is not consistent across the voter file, and a blank
          // would render as an empty phone row at the door.
          cellPhone: row.cellPhone?.trim() || null,
          landline: row.landline?.trim() || null,
          ...mapDemographics(row),
        })
      } else {
        address.otherResidents.push({
          personId: row.id,
          firstName: row.firstName,
          lastName: row.lastName,
        })
      }
    }

    // A requested addressKey with no current residents is simply absent —
    // the caller renders that unit from its frozen snapshot.
    return DoorKnockingResidentsResponseSchema.parse({
      addresses: [...byAddress.values()],
    })
  }
}
