import { BadRequestException, Injectable } from '@nestjs/common'
import {
  DoorKnockingEvaluateResponse,
  DoorKnockingEvaluateResponseSchema,
  DoorKnockingResidentsResponse,
  DoorKnockingResidentsResponseSchema,
} from '@goodparty_org/contracts'
import { Prisma } from 'src/generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { DistrictService } from 'src/district/services/district.service'
import { DATABASE_SCHEMA } from 'src/people/services/people.service'
import { buildDoorKnockingAddressKeySql } from '../utils/doorKnockingAddressKey.utils'
import { buildVoterWhereSql } from 'src/people/utils/buildVoterWhereSql.utils'
import { resolveDistrict } from 'src/people/utils/resolveDistrict.utils'
import {
  mapAge,
  mapPoliticalParty,
} from 'src/people/utils/transformToPersonOutput.utils'
import { FilterData } from 'src/people/schemas/filters.schema'
import {
  DoorKnockingEvaluateDTO,
  DoorKnockingResidentsDTO,
} from '../doorKnocking.schema'
import { buildBboxSql } from '../utils/bboxSql.utils'

const VOTER_TABLE = Prisma.raw(`"${DATABASE_SCHEMA}"."Voter"`)
const DV_TABLE = Prisma.raw(`"${DATABASE_SCHEMA}"."DistrictVoter"`)

const DV_JOIN = Prisma.sql`JOIN ${DV_TABLE} dv
  ON v."State" = dv."State" AND v."id" = dv."voter_id"`

// v1 quality gate: rooftop-geocoded rows only (>90% of the file). Widening
// to more accuracy tiers is a WHERE change here, not a contract change.
const ROOFTOP_ONLY = Prisma.sql`v."Residence_Addresses_LatLongAccuracy" = 'GeoMatchRooftop'`

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
  addressKey: string
}

@Injectable()
export class DoorKnockingService extends createPrismaBase(MODELS.Voter) {
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
      extraConditions: [ROOFTOP_ONLY, buildBboxSql(dto.bbox)],
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
