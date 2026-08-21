import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import type { IdOverrides, PeopleFilters } from '@goodparty_org/contracts'
import { PeopleDbModule } from '@/peopleDb/peopleDb.module'
import { PeopleQueryModule } from '@/peopleDb/peopleQuery.module'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { StatsService } from '@/peopleDb/services/stats.service'
import { VoterDownloadService } from '@/peopleDb/services/voterDownload.service'
import { DatabricksVoterService } from '@/peopleDb/databricks/databricksVoter.service'
import { PeopleDbxStatementClient } from '@/peopleDb/databricks/peopleDbxStatement.client'
import {
  createBag,
  VOTER_TABLE,
} from '@/peopleDb/databricks/databricksVoterSql.util'
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
  const app = await NestFactory.createApplicationContext(BenchModule, {
    logger: false,
  })
  const voterQuery = app.get(VoterQueryService)
  const stats = app.get(StatsService)
  const download = app.get(VoterDownloadService)
  const dbxVoters = app.get(DatabricksVoterService)
  const dbxClient = app.get(PeopleDbxStatementClient)

  const idSets = new Map<string, string[]>()

  // Setup, not measurement. Call prepare() before the timed loop: sampling
  // costs ~0.5-1.5s per cohort and would otherwise land inside the first
  // outreach cell's timing.
  // The Databricks store scopes on the voter row's own L2 district column, so
  // there is no junction table to sample from — and no separate voter-only
  // branch beyond dropping that column predicate.
  const sampleIdsFromDbx = async (districtId: string): Promise<string[]> => {
    const district = await dbxVoters.resolveDistrict(districtId)
    const bag = createBag()
    const scope = [`v.\`State\` = ${bag.bind(district.state)}`]
    if (district.useVoterOnlyPath) {
      scope.push(
        `substr(md5(v.\`id\`), 1, 2) = ${bag.bind(STATEWIDE_ID_BUCKET)}`,
      )
    } else {
      scope.push(
        `v.\`${district.districtType}\` = ${bag.bind(district.districtName)}`,
      )
    }
    const seed = bag.bind(ID_SAMPLE_SEED)
    const limit = bag.bind(ID_SET_SIZE, 'INT')
    const { rows } = await dbxClient.query({
      sql:
        `SELECT v.\`id\` FROM ${VOTER_TABLE} v WHERE ${scope.join(' AND ')}` +
        ` ORDER BY md5(concat(v.\`id\`, ${seed})) LIMIT ${limit}`,
      params: bag.params,
    })
    return rows
      .map(([id]) => id)
      .filter((id): id is string => typeof id === 'string')
  }

  const sampleIds = async (districtId: string): Promise<string[]> => {
    const cached = idSets.get(districtId)
    if (cached) return cached
    const ids = await sampleIdsFromDbx(districtId)
    if (ids.length === 0) {
      throw new Error(`no ids sampled for district ${districtId}`)
    }
    idSets.set(districtId, ids)
    return ids
  }

  const prepare = async (cases: BenchCase[]): Promise<void> => {
    const needed = [
      ...new Set(
        cases.filter((c) => c.variant.idSet).map((c) => c.cohort.districtId),
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
      // One whole GET /v1/contacts/list-detail, not one query: mirrors
      // ContactsService.fetchListDetailAggregates, which resolves the
      // load-bearing base tile FIRST and only then fans out to the three
      // channel-restricted tiles in parallel. Benchmarking 'count' alone
      // understates a real request by ~4x, and the serial-then-parallel shape
      // is what decides how long a connection is actually held.
      case 'list-detail': {
        // Base is awaited on its own so a base rejection throws — that IS the
        // 504. The channels then settle independently, matching the service:
        // a rejected channel becomes a null "Unavailable" tile and the request
        // still returns 200, so counting one here as a benchmark failure would
        // be a false regression. A slow channel is not hidden by this — the
        // case still waits for it, so it shows up as a slow cell.
        await voterQuery.getAggregates(
          aggregatesSchema.parse({ districtId, filters }),
        )
        await Promise.allSettled(
          [
            { ...filters, hasCellPhone: true },
            { ...filters, hasLandline: true },
            { ...filters, hasAddress: true },
          ].map((channelFilters) =>
            voterQuery.getAggregates(
              aggregatesSchema.parse({ districtId, filters: channelFilters }),
            ),
          ),
        )
        return
      }
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
      case 'stats':
        await stats.findStats({ districtId } as unknown as StatsDTO)
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
