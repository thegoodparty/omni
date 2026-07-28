import { Injectable } from '@nestjs/common'
import { DoorKnockingPackRequest } from '@goodparty_org/contracts'
import { Prisma } from 'src/generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { DistrictService } from 'src/district/services/district.service'
import { buildHouseholdKeySql } from 'src/people/utils/buildHouseholdKeySql.utils'
import { buildVoterWhereSql } from 'src/people/utils/buildVoterWhereSql.utils'
import { resolveDistrict } from 'src/people/utils/resolveDistrict.utils'
import { FilterData } from 'src/people/schemas/filters.schema'
import {
  PackEncoder,
  PackRow,
  statusesToBytes,
} from '../utils/packEncoder.utils'

const VOTER_TABLE = Prisma.raw('"green"."Voter"')
const DV_TABLE = Prisma.raw('"green"."DistrictVoter"')
const DV_JOIN = Prisma.sql`JOIN ${DV_TABLE} dv
  ON v."State" = dv."State" AND v."id" = dv."voter_id"`

const NUMERIC_TEXT = '^-?[0-9]+(\\.[0-9]+)?$'
// Same v1 quality gate as turf evaluation: rooftop-geocoded rows only. The
// regex predicates make the SELECT's ::float8 casts safe (only surviving
// rows are projected).
const MAPPABLE_ONLY = Prisma.sql`v."Residence_Addresses_LatLongAccuracy" = 'GeoMatchRooftop'
  AND v."Residence_Addresses_Latitude" ~ ${NUMERIC_TEXT}
  AND v."Residence_Addresses_Longitude" ~ ${NUMERIC_TEXT}`

const EMPTY_FILTERS: FilterData = {
  filters: [],
  filterValues: {},
  filterOperators: {},
}

const BATCH_SIZE = 50_000

@Injectable()
export class DoorKnockingPackService extends createPrismaBase(MODELS.Voter) {
  constructor(private readonly districtService: DistrictService) {
    super()
  }

  // One keyset-paginated pass over the district: rows stream through the
  // SoA encoder in bounded batches, never materializing the whole district
  // as JS objects. The pack is a payload, not an artifact — built per
  // request, never stored.
  async build(request: DoorKnockingPackRequest): Promise<Buffer> {
    const resolved = await resolveDistrict(this.districtService, request)
    const effectiveDistrictId = resolved.useVoterOnlyPath
      ? null
      : request.districtId
    const joinClause = effectiveDistrictId ? DV_JOIN : Prisma.empty

    const encoder = new PackEncoder(
      statusesToBytes(request.knockStatuses ?? []),
    )

    let cursor: string | null = null
    for (;;) {
      const whereClause = buildVoterWhereSql({
        state: resolved.state,
        districtId: effectiveDistrictId,
        filters: EMPTY_FILTERS,
        extraConditions: [
          MAPPABLE_ONLY,
          ...(cursor !== null ? [Prisma.sql`v."id" > ${cursor}::uuid`] : []),
        ],
      })
      const rows: PackRow[] = await this.client.$queryRaw<PackRow[]>(
        Prisma.sql`
        SELECT v."id",
          v."Residence_Addresses_Latitude"::float8 AS "lat",
          v."Residence_Addresses_Longitude"::float8 AS "lng",
          ${buildHouseholdKeySql('v')} AS "hhKey",
          v."Parties_Description",
          v."Age_Int",
          v."Gender",
          v."Voter_Status",
          v."Marital_Status",
          v."Veteran_Status",
          v."Presence_Of_Children",
          v."Homeowner_Probability_Model",
          v."Business_Owner",
          v."Education_Of_Person",
          v."Estimated_Income_Amount_Int",
          v."Language_Code",
          v."EthnicGroups_EthnicGroup1Desc",
          (v."StateVoterID" IS NOT NULL) AS "registered",
          (v."VoterTelephones_CellPhoneFormatted" IS NOT NULL) AS "hasCellPhone",
          (v."VoterTelephones_LandlineFormatted" IS NOT NULL) AS "hasLandline"
        FROM ${VOTER_TABLE} v
        ${joinClause}
        ${whereClause}
        ORDER BY v."id"
        LIMIT ${BATCH_SIZE}`,
      )
      for (const row of rows) {
        encoder.add(row)
      }
      if (rows.length < BATCH_SIZE) break
      cursor = rows[rows.length - 1]?.id ?? null
      if (cursor === null) break
    }

    return encoder.toBuffer(new Date().toISOString())
  }
}
