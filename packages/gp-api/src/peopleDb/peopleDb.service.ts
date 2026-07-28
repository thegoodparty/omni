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
  private activeClient?: PeopleDbPrismaClient
  private unsubscribe: (() => void) | null = null

  constructor(private readonly peopleDbUrl: PeopleDbUrlProvider) {}

  // The live people-db Prisma client. Callers must always read through this
  // getter (never cache the reference) so they follow the client across a
  // database-URL swap.
  get instance(): PeopleDbPrismaClient {
    if (!this.activeClient) {
      throw new Error(
        'people-db client not initialized — PEOPLE_DATABASE_URL / SSM parameter is unresolved',
      )
    }
    return this.activeClient
  }

  // A satellite dependency (people-db) must never take down the whole gp-api
  // monolith at boot — fail soft here and let a request-time call to
  // `.instance` surface the misconfiguration instead. The url provider's
  // 5-min refresh + onChange->swap recovers automatically once the URL
  // becomes resolvable.
  async onModuleInit() {
    try {
      const url = await this.peopleDbUrl.ensureLoaded()
      this.activeClient = await this.buildClient(url)
      this.unsubscribe = this.peopleDbUrl.onChange((url) => {
        void this.swap(url)
      })
    } catch (err) {
      this.logger.debug(
        { err },
        'people-db not initialized at boot; will retry lazily on first query',
      )
    }
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
      previous?.$disconnect().catch((err: Error) => {
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

    // Fail-soft connect: attempt it for an early diagnostic signal on a
    // genuinely broken PEOPLE_DATABASE_URL in deployed envs, but don't let a
    // failure here block boot — gp-api's core boot must not hard-depend on
    // people-db being reachable, and there is no people-db test container in
    // this project (Task 1.4 was eliminated), so the dummy .env.test URL
    // will always fail this connect in every useTestService suite. Prisma
    // reconnects lazily on the first real query against `.instance` either
    // way, and that failure surfaces loudly there.
    try {
      await client.$connect()
    } catch (err) {
      this.logger.debug(
        { err },
        'Initial people-db connect failed; will retry lazily on first query',
      )
    }
    return client
  }
}
