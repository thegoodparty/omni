import { Injectable } from '@nestjs/common'
import { DoorKnockingPackRequest } from '@goodparty_org/contracts'
import { Prisma } from '../../generated/people-prisma'
import { createPeopleDbBase, PEOPLE_MODELS } from '../peopleDbBase.util'
import { DistrictService } from './district.service'
import { buildHouseholdKeySql } from '../utils/buildHouseholdKeySql.util'
import { buildVoterWhereSql } from '../utils/buildVoterWhereSql.util'
import { resolveDistrict } from '../utils/resolveDistrict.util'
import { FilterData } from '../schemas/filters.schema'
import {
  PackEncoder,
  PackRow,
  statusesToBytes,
} from '../utils/packEncoder.utils'
import { runUnderStatementTimeout } from '../utils/statementTimeout.util'

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

const BATCH_TIMEOUT_MESSAGE =
  'The voter map took too long to build. Please try again.'

@Injectable()
export class VoterPackService extends createPeopleDbBase(PEOPLE_MODELS.Voter) {
  constructor(private readonly districtService: DistrictService) {
    super()
  }

  // One keyset-paginated pass over the district: rows stream through the
  // SoA encoder in bounded batches, never materializing the whole district
  // as JS objects. The pack is a payload, not an artifact — built per
  // request, never stored.
  //
  // `signal` is the caller's response stream. A build with nobody left to
  // read it stops at the next batch boundary rather than scanning the rest of
  // the district for a socket that is already closed.
  async build(
    request: DoorKnockingPackRequest,
    signal?: AbortSignal,
  ): Promise<Buffer> {
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
      if (signal?.aborted) {
        throw new Error('pack build abandoned: the client is gone')
      }
      const whereClause = buildVoterWhereSql({
        state: resolved.state,
        districtId: effectiveDistrictId,
        filters: EMPTY_FILTERS,
        extraConditions: [
          MAPPABLE_ONLY,
          ...(cursor !== null ? [Prisma.sql`v."id" > ${cursor}::uuid`] : []),
        ],
      })
      // Guarded like every other people-db query (see peopleDb/AGENTS.md):
      // unguarded, a pathological plan here rides the 60s socket timeout and
      // keeps burning people-db CPU for another 35s after the request has been
      // abandoned — the exact amplification a retry on a slow endpoint causes.
      const rows: PackRow[] = await runUnderStatementTimeout<PackRow>(
        this.client,
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
        this.logger,
        BATCH_TIMEOUT_MESSAGE,
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
