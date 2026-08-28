import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import type { IdOverrides, PeopleFilters } from '@goodparty_org/contracts'
import { PeopleDbModule } from '@/peopleDb/peopleDb.module'
import { PeopleQueryModule } from '@/peopleDb/peopleQuery.module'
import { PeopleDbService } from '@/peopleDb/peopleDb.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { StatsService } from '@/peopleDb/services/stats.service'
import { DistrictService } from '@/peopleDb/services/district.service'
import { VoterDownloadService } from '@/peopleDb/services/voterDownload.service'
import { VoterDensityService } from '@/peopleDb/services/voterDensity.service'
import { resolveDistrict } from '@/peopleDb/utils/resolveDistrict.util'
import { stateEquals } from '@/peopleDb/utils/buildVoterWhereSql.util'
import {
  listPeopleSchema,
  aggregatesSchema,
  overlapCountSchema,
  samplePeopleSchema,
  downloadPeopleSchema,
} from '@/peopleDb/schemas/people.schema'
import type { StatsDTO } from '@/peopleDb/schemas/people.schema'
import { createNullSink } from './nullSink'
import type { BenchCase } from './cases'
import { ID_SAMPLE_SEED, ID_SET_SIZE } from './filterVariants'

@Module({ imports: [PeopleDbModule, PeopleQueryModule] })
class BenchModule {}

const SEARCH_TERM = 'smith'

// Bucketing the candidates keeps the statewide sample off a 23M-row sort. One
// hex pair is ~1/256 of the partition, which still leaves ~90k CA rows to draw
// 5k from, and the survivors stay spread through the heap.
const STATEWIDE_ID_BUCKET = 'a3'

type IdSetRequest = {
  filters: PeopleFilters
  contactsMadeIdOverrides?: IdOverrides
}

export type Harness = {
  invoke: (c: BenchCase) => Promise<void>
  prepare: (cases: BenchCase[]) => Promise<void>
  totalConstituents: (districtId: string) => Promise<number>
  close: () => Promise<void>
}

export const createHarness = async (): Promise<Harness> => {
  if (!process.env.PEOPLE_DATABASE_URL) {
    throw new Error(
      'PEOPLE_DATABASE_URL must be set before booting the harness',
    )
  }
  const app = await NestFactory.createApplicationContext(BenchModule, {
    logger: false,
  })
  const voterQuery = app.get(VoterQueryService)
  const stats = app.get(StatsService)
  const download = app.get(VoterDownloadService)
  const voterDensity = app.get(VoterDensityService)
  const districts = app.get(DistrictService)
  const peopleDb = app.get(PeopleDbService)

  const idSets = new Map<string, string[]>()

  // Setup, not measurement. Call prepare() before the timed loop: sampling
  // costs ~0.5-1.5s per cohort and would otherwise land inside the first
  // outreach cell's timing.
  const sampleIds = async (districtId: string): Promise<string[]> => {
    const cached = idSets.get(districtId)
    if (cached) return cached
    const { useVoterOnlyPath, state } = await resolveDistrict(districts, {
      districtId,
    })
    const client = peopleDb.instance
    // A State district has NO DistrictVoter rows at all (verified against prod:
    // count is 0), so the voter-only path is required here, not merely faster.
    // stateEquals inlines the state as a literal because a bound-and-cast
    // parameter breaks the planner's constant propagation; the bucket predicate
    // keeps the sort off the whole 23M-row partition.
    const rows = useVoterOnlyPath
      ? await client.$queryRaw<{ id: string }[]>`
          SELECT v."id"::text AS id
          FROM "green"."Voter" v
          WHERE ${stateEquals('v', state)}
            AND substr(md5(v."id"::text), 1, 2) = ${STATEWIDE_ID_BUCKET}
          ORDER BY md5(v."id"::text || ${ID_SAMPLE_SEED})
          LIMIT ${ID_SET_SIZE}`
      : // No join to Voter: dv."voter_id" IS the id we want, and joining costs
        // one random probe into a cold multi-GB state partition per sampled
        // row (measured 44-60s per cohort against ~1s without it).
        await client.$queryRaw<{ id: string }[]>`
          SELECT dv."voter_id"::text AS id
          FROM "green"."DistrictVoter" dv
          WHERE dv."district_id" = ${districtId}::uuid
          ORDER BY md5(dv."voter_id"::text || ${ID_SAMPLE_SEED})
          LIMIT ${ID_SET_SIZE}`
    const ids = rows.map((r) => r.id)
    if (ids.length === 0) {
      throw new Error(`no ids sampled for district ${districtId}`)
    }
    idSets.set(districtId, ids)
    return ids
  }

  const prepare = async (cases: BenchCase[]): Promise<void> => {
    const needed = [
      ...new Set(
        cases
          // voter-by-id needs a real id too, and sampling inside the timed
          // loop is what inflated a cell by ~50s before this existed.
          .filter((c) => c.variant.idSet || c.queryType === 'voter-by-id')
          .map((c) => c.cohort.districtId),
      ),
    ]
    for (const districtId of needed) await sampleIds(districtId)
  }

  // Turn a variant's idSet shape into the request fields gp-api would send.
  // The mixed case mirrors ContactsMadeResolutionService: the bucket ids are a
  // subset of the contacted set, which is why it cannot collapse into one
  // in/notIn operator and travels as contactsMadeIdOverrides instead.
  const idSetRequest = async (c: BenchCase): Promise<IdSetRequest> => {
    const filters = c.variant.payload
    if (!c.variant.idSet) return { filters }
    const ids = await sampleIds(c.cohort.districtId)
    if (c.variant.idSet === 'in') {
      return { filters: { ...filters, id: { in: ids } } }
    }
    if (c.variant.idSet === 'notIn') {
      return { filters: { ...filters, id: { notIn: ids } } }
    }
    return {
      filters,
      contactsMadeIdOverrides: {
        include: ids.slice(0, Math.max(1, Math.floor(ids.length / 5))),
        exclude: ids,
      },
    }
  }

  const invoke = async (c: BenchCase): Promise<void> => {
    const districtId = c.cohort.districtId
    const filters = c.variant.payload
    const idReq = await idSetRequest(c)
    switch (c.queryType) {
      case 'list':
        await voterQuery.findPeople(
          listPeopleSchema.parse({ districtId, ...idReq }),
        )
        return
      case 'search':
        await voterQuery.findPeople(
          listPeopleSchema.parse({ districtId, filters, search: SEARCH_TERM }),
        )
        return
      case 'count':
        await voterQuery.getAggregates(
          aggregatesSchema.parse({ districtId, ...idReq }),
        )
        return
      // One whole GET /v1/contacts/list-detail, not one query. Databricks
      // answers this in a single conditional-aggregate statement, but this
      // suite measures the Postgres arm, which still resolves the base tile
      // plus one aggregate per channel — so benchmarking 'count' alone
      // understates a real request by roughly 5x.
      case 'list-detail':
        await voterQuery.getListDetailAggregates(
          aggregatesSchema.parse({ districtId, filters }),
        )
        return
      case 'overlap':
        await voterQuery.getOverlapCount(
          overlapCountSchema.parse({
            districtId,
            filters,
            savedFilterSets: [filters],
          }),
        )
        return
      case 'sample':
        await voterQuery.samplePeople(
          samplePeopleSchema.parse({ districtId, size: 1000 }),
        )
        return
      // Both by-id cases are single-row primary-key reads. The voter id comes
      // from the same sampled set prepare() already materializes, so this adds
      // no setup cost and uses an id that provably exists in the district.
      case 'district-by-id':
        await districts.findDistrictById(districtId)
        return
      case 'voter-by-id': {
        const ids = await sampleIds(districtId)
        const [id] = ids
        if (!id) throw new Error(`no ids sampled for district ${districtId}`)
        await voterQuery.findPerson(id, { districtId } as never)
        return
      }
      case 'stats': {
        const statsDto: StatsDTO = { districtId }
        await stats.findStats(statsDto)
        return
      }
      case 'voterDensity':
        await voterDensity.getVoterDensity(districtId)
        return
      case 'csv': {
        const sink = createNullSink()
        const dto = downloadPeopleSchema.parse({ districtId, filters })
        await download.streamPeopleCsv(dto, sink.reply)
        await sink.finished
        if (sink.rows() === 0) {
          throw new Error(`csv produced no rows for ${districtId}`)
        }
        return
      }
    }
  }

  const totalConstituents = async (districtId: string): Promise<number> =>
    (await stats.findTotalCounts(districtId))?.totalConstituents ?? 0

  return { invoke, prepare, totalConstituents, close: () => app.close() }
}
