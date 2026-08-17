import { NestFactory } from '@nestjs/core'
import { Module } from '@nestjs/common'
import { PeopleDbModule } from '@/peopleDb/peopleDb.module'
import { PeopleQueryModule } from '@/peopleDb/peopleQuery.module'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { StatsService } from '@/peopleDb/services/stats.service'
import { VoterDownloadService } from '@/peopleDb/services/voterDownload.service'
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

@Module({ imports: [PeopleDbModule, PeopleQueryModule] })
class BenchModule {}

const SEARCH_TERM = 'smith'

export type Harness = {
  invoke: (c: BenchCase) => Promise<void>
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

  const invoke = async (c: BenchCase): Promise<void> => {
    const districtId = c.cohort.districtId
    const filters = c.variant.payload
    switch (c.queryType) {
      case 'list':
        await voterQuery.findPeople(
          listPeopleSchema.parse({ districtId, filters }),
        )
        return
      case 'search':
        await voterQuery.findPeople(
          listPeopleSchema.parse({ districtId, filters, search: SEARCH_TERM }),
        )
        return
      case 'count':
        await voterQuery.getAggregates(
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

  return { invoke, totalConstituents, close: () => app.close() }
}
