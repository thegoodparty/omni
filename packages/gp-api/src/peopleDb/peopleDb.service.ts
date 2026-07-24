import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import { Prisma, PrismaClient } from '../generated/people-prisma'
import { PeopleDbUrlProvider } from './peopleDbUrl.provider'

const PRISMA_LOG_LEVELS = [
  'info',
  'warn',
  'error',
  ...(process.env.LOG_LEVEL === 'debug' ? ['query' as Prisma.LogLevel] : []),
]

export type PeopleDbPrismaClient = PrismaClient<
  Prisma.PrismaClientOptions,
  'query'
>

@Injectable()
export class PeopleDbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PeopleDbService.name)
  private activeClient!: PeopleDbPrismaClient
  private unsubscribe: (() => void) | null = null

  constructor(private readonly peopleDbUrl: PeopleDbUrlProvider) {}

  // The live people-db Prisma client. Callers must always read through this
  // getter (never cache the reference) so they follow the client across a
  // database-URL swap.
  get instance(): PeopleDbPrismaClient {
    return this.activeClient
  }

  async onModuleInit() {
    const url = await this.peopleDbUrl.ensureLoaded()
    this.activeClient = await this.buildClient(url)
    this.unsubscribe = this.peopleDbUrl.onChange((url) => {
      void this.swap(url)
    })
  }

  async onModuleDestroy() {
    this.unsubscribe?.()
    await this.activeClient?.$disconnect()
  }

  private async swap(url: string) {
    try {
      const next = await this.buildClient(url)
      const previous = this.activeClient
      this.activeClient = next
      this.logger.log('Swapped people-db Prisma client to new database URL')
      // $disconnect drains in-flight queries before closing connections, so no
      // explicit delay is needed. Fire-and-forget: a failed teardown of the old
      // client must not disturb the now-live new one.
      previous.$disconnect().catch((err: Error) => {
        this.logger.warn(
          { err },
          'Failed to disconnect previous people-db Prisma client',
        )
      })
    } catch (err) {
      this.logger.error(
        { err },
        'Failed to build swapped people-db Prisma client; keeping current',
      )
    }
  }

  private async buildClient(
    databaseUrl: string,
  ): Promise<PeopleDbPrismaClient> {
    const url = new URL(databaseUrl)
    url.searchParams.set('connection_limit', '25')
    url.searchParams.set('pool_timeout', '5')
    url.searchParams.set('connect_timeout', '5')
    // Queries that take longer than 60 seconds will be cancelled.
    url.searchParams.set('socket_timeout', '60')

    const client = new PrismaClient<Prisma.PrismaClientOptions, 'query'>({
      log: PRISMA_LOG_LEVELS.map((level) => ({
        emit: 'event',
        // Prisma log level from string config — Prisma types the config array loosely
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        level: level as Prisma.LogLevel,
      })),
      errorFormat: 'pretty',
      datasources: {
        peopleDb: { url: url.toString() },
      },
    })

    client.$on('query', (event: Prisma.QueryEvent) => {
      this.logger.debug(
        {
          query: event.query,
          params: event.params,
          durationMs: event.duration,
        },
        'Completed SQL query',
      )
    })

    // No eager $connect() here (unlike the ported gp-api/people-api
    // PrismaService, which does connect eagerly for its one primary DB):
    // gp-api's core boot must not hard-depend on people-db being reachable,
    // and there is no people-db test container in this project (Task 1.4 was
    // eliminated) — every useTestService suite boots this Global module, so an
    // eager connect would fail every suite's bootstrap. Prisma connects
    // lazily on first query against `.instance` regardless.
    return client
  }
}
