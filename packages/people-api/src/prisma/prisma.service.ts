import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import { Prisma, PrismaClient } from '../generated/prisma'
import { DatabaseUrlProvider } from './database-url.provider'

const PRISMA_LOG_LEVELS = [
  'info',
  'warn',
  'error',
  ...(process.env.LOG_LEVEL === 'debug' ? ['query' as Prisma.LogLevel] : []),
]

type LoggingPrismaClient = PrismaClient<Prisma.PrismaClientOptions, 'query'>

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private logger = new Logger(PrismaService.name)
  private activeClient!: LoggingPrismaClient
  private unsubscribe: (() => void) | null = null

  constructor(private readonly databaseUrl: DatabaseUrlProvider) {}

  // The live Prisma client. Callers must always read through this getter (never
  // cache the reference) so they follow the client across a database-URL swap.
  get instance(): LoggingPrismaClient {
    return this.activeClient
  }

  async onModuleInit() {
    const url = await this.databaseUrl.ensureLoaded()
    this.activeClient = await this.buildClient(url)
    this.unsubscribe = this.databaseUrl.onChange((url) => {
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
      this.logger.log('Swapped Prisma client to new database URL')
      // $disconnect drains in-flight queries before closing connections, so no
      // explicit delay is needed. Fire-and-forget: a failed teardown of the old
      // client must not disturb the now-live new one.
      previous.$disconnect().catch((err: unknown) => {
        this.logger.warn({ err }, 'Failed to disconnect previous Prisma client')
      })
    } catch (err) {
      this.logger.error(
        { err },
        'Failed to build swapped Prisma client; keeping current',
      )
    }
  }

  private async buildClient(databaseUrl: string): Promise<LoggingPrismaClient> {
    // Parse the database URL and add connection pool parameters
    const url = new URL(databaseUrl)
    url.searchParams.set('connection_limit', '25')
    url.searchParams.set('pool_timeout', '5')
    url.searchParams.set('connect_timeout', '5')
    // Queries that take longer than 60 seconds will be cancelled.
    url.searchParams.set('socket_timeout', '60')
    if (process.env.NODE_ENV === 'perf-local') {
      url.searchParams.set('options', '-c default_transaction_read_only=on')
    }

    const client = new PrismaClient<Prisma.PrismaClientOptions, 'query'>({
      log: PRISMA_LOG_LEVELS.map((level) => ({
        emit: 'event',
        level: level as Prisma.LogLevel,
      })),
      errorFormat: 'pretty',
      datasources: {
        db: { url: url.toString() },
      },
    })

    if (process.env.NODE_ENV === 'perf-local') {
      client.$executeRaw = ((
        ..._args: Parameters<PrismaClient['$executeRaw']>
      ) => {
        throw new Error('Writes are disabled in perf-local')
      }) as PrismaClient['$executeRaw']
      client.$queryRawUnsafe = ((
        ..._args: Parameters<PrismaClient['$queryRawUnsafe']>
      ) => {
        throw new Error('Raw unsafe queries are disabled in perf-local')
      }) as PrismaClient['$queryRawUnsafe']
    }

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

    await client.$connect()
    return client
  }
}
