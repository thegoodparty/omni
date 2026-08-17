import { BadRequestException, Injectable } from '@nestjs/common'
import {
  DoorKnockingEvaluateResponse,
  DoorKnockingEvaluateResponseSchema,
  DoorKnockingResidentsResponse,
  DoorKnockingResidentsResponseSchema,
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
  mapPoliticalParty,
} from '../utils/transformToPersonOutput.util'
import { FilterData } from '../schemas/filters.schema'
import {
  DoorKnockingEvaluateDTO,
  DoorKnockingResidentsDTO,
} from '../schemas/doorKnocking.schema'
import { buildBboxSql } from '../utils/bboxSql.util'

const VOTER_TABLE = Prisma.raw(`"${DATABASE_SCHEMA}"."Voter"`)
const DV_TABLE = Prisma.raw(`"${DATABASE_SCHEMA}"."DistrictVoter"`)

const DV_JOIN = Prisma.sql`JOIN ${DV_TABLE} dv
  ON v."State" = dv."State" AND v."id" = dv."voter_id"`

// v1 quality gate: rooftop-geocoded rows only (>90% of the file). Widening
// to more accuracy tiers is a WHERE change here, not a contract change.
const ROOFTOP_ONLY = Prisma.sql`v."Residence_Addresses_LatLongAccuracy" = 'GeoMatchRooftop'`

// ADR 0007. An unconditional conjunct alongside ROOFTOP_ONLY rather than an
// id-override on a filter clause: the override slots hang off a specific
// filter (voterStatus, contacts-made) and vanish when that filter is absent,
// which is the one failure mode a do-not-knock must not have.
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
}

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
        // filter is empty, and a do-not-knock has to hold regardless of what
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
    const rows = await this.client.$queryRaw<EvaluateRow[]>(Prisma.sql`
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
      LIMIT ${dto.maxPeople + 1}`)

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
    const rows = await this.client.$queryRaw<ResidentRow[]>(Prisma.sql`
      SELECT v."id",
        v."FirstName" AS "firstName",
        v."LastName" AS "lastName",
        v."Age",
        v."Age_Int",
        v."Parties_Description",
        v."VoterTelephones_CellPhoneFormatted" AS "cellPhone",
        v."VoterTelephones_LandlineFormatted" AS "landline",
        ${buildDoorKnockingAddressKeySql('v')} AS "addressKey"
      FROM ${VOTER_TABLE} v
      ${joinClause}
      ${whereClause}
      LIMIT ${residentsCap + 1}`)

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
