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
  contactsMadeToBytes,
  PackEncoder,
  PackRow,
  statusesToBytes,
} from '../utils/packEncoder.utils'
import { scanUnderCursor } from '../utils/cursorScan.util'

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

const SCAN_TIMEOUT_MESSAGE =
  'The voter map took too long to build. Please try again.'

@Injectable()
export class VoterPackService extends createPeopleDbBase(PEOPLE_MODELS.Voter) {
  constructor(private readonly districtService: DistrictService) {
    super()
  }

  // One unordered pass over the district, read through a server-side cursor:
  // rows reach the SoA encoder in bounded chunks, so the district is never
  // materialized as JS objects at once. The pack is a payload, not an artifact
  // — built per request, never stored.
  //
  // This used to keyset-paginate, and that was the endpoint's real cost. The
  // `v."id" > cursor` predicate reached the Voter side of the merge join and
  // not the DistrictVoter side, so every page re-walked the district from the
  // start: 58k DV rows scanned on page 0, 407k on page 6. The pass was
  // quadratic in district size, and it made Postgres read **11.5 GB from
  // storage to return a 16 MB response** (`docs/perf/voter-pack-profile.md`).
  // One statement reads 945 MB, sequentially, and measures 2.4-2.8x faster end
  // to end.
  //
  // `ORDER BY v."id"` went with it, and nothing downstream can see that. The
  // pack carries no person identity on the wire — the client walks person →
  // household → dot positionally and aggregates (`filterEngine.ts`), turfs are
  // persisted as polygons rather than as pack indices, and no manifest field
  // names a row. Ordering existed only to make keyset pagination work.
  //
  // `signal` is the caller's response stream. A build with nobody left to read
  // it stops at the next chunk rather than scanning the rest of the district
  // for a socket that is already closed.
  async build(
    request: DoorKnockingPackRequest,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    const resolved = await resolveDistrict(this.districtService, request)
    const effectiveDistrictId = resolved.useVoterOnlyPath
      ? null
      : request.districtId
    const joinClause = effectiveDistrictId ? DV_JOIN : Prisma.empty

    // Both campaign-specific planes are joined here, from arrays gp-api
    // shipped with the request; the scan below reads nothing per-organization
    // and is therefore a pure function of `districtId` and the voter mirror.
    // Keep it that way — it is what makes the shared build cacheable (see
    // docs/perf/voter-pack-headroom.md).
    const encoder = new PackEncoder(
      statusesToBytes(request.knockStatuses ?? []),
      contactsMadeToBytes(request.contactsMade),
    )

    const whereClause = buildVoterWhereSql({
      state: resolved.state,
      districtId: effectiveDistrictId,
      filters: EMPTY_FILTERS,
      extraConditions: [MAPPABLE_ONLY],
    })

    await scanUnderCursor<PackRow>(
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
      ${whereClause}`,
      {
        logger: this.logger,
        timeoutMessage: SCAN_TIMEOUT_MESSAGE,
        signal,
        onRows: (rows) => {
          for (const row of rows) {
            encoder.add(row)
          }
        },
      },
    )

    return encoder.toBuffer(new Date().toISOString())
  }
}
