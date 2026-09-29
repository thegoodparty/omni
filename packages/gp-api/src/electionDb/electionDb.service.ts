import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import { Prisma, PrismaClient } from '../generated/election-prisma'

// Gated on its own flag rather than on LOG_LEVEL, matching PrismaService.
// gp-api deploys LOG_LEVEL=debug in prod, so gating on it would serialize
// every election query — with parameters — onto the request event loop and
// ship it to Loki. The level is gated alongside the listener so the engine
// does not emit the event at all when it is off.
const enableQueryLogging = process.env.ENABLE_QUERY_LOGGING === 'true'

const PRISMA_LOG_LEVELS = [
  'info',
  'warn',
  'error',
  ...(enableQueryLogging ? ['query' as Prisma.LogLevel] : []),
]

// Previews share one small Aurora across ~10 concurrent PR stacks, so they get
// the same cap gp-api's own pool takes in docker-entrypoint.sh. dev/prod keep
// election-api's per-task value so the total against the cluster is unchanged.
const CONNECTION_LIMIT = process.env.IS_PREVIEW === 'true' ? '5' : '25'

export type ElectionDbPrismaClient = PrismaClient<
  Prisma.PrismaClientOptions,
  'query'
>

@Injectable()
export class ElectionDbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ElectionDbService.name)
  private activeClient?: ElectionDbPrismaClient

  get instance(): ElectionDbPrismaClient {
    if (!this.activeClient) {
      throw new Error(
        'election-db client not initialized — check ELECTION_DATABASE_URL and ' +
          'the boot logs for the initialization error',
      )
    }
    return this.activeClient
  }

  // A satellite database must never take down the whole gp-api monolith at
  // boot — fail soft here and let a request-time call to `.instance` surface
  // the misconfiguration instead. Note this is deliberately weaker than the
  // migration gate: `prisma migrate deploy` for this schema stays fatal in
  // docker-entrypoint.sh, so a genuinely broken deploy still fails loudly.
  async onModuleInit() {
    const url = process.env.ELECTION_DATABASE_URL
    if (!url) {
      this.logger.warn(
        'ELECTION_DATABASE_URL is not set; election-db client not initialized',
      )
      return
    }
    try {
      this.activeClient = await this.buildClient(url)
    } catch (err) {
      this.logger.error(
        { err },
        'election-db client could not be initialized — every election-backed ' +
          'route will fail until this is resolved',
      )
    }
  }

  async onModuleDestroy() {
    await this.activeClient?.$disconnect()
  }

  private async buildClient(
    databaseUrl: string,
  ): Promise<ElectionDbPrismaClient> {
    const url = new URL(databaseUrl)
    url.searchParams.set('connection_limit', CONNECTION_LIMIT)
    url.searchParams.set('pool_timeout', '5')
    url.searchParams.set('connect_timeout', '5')

    const client = new PrismaClient<Prisma.PrismaClientOptions, 'query'>({
      log: PRISMA_LOG_LEVELS.map((level) => ({
        emit: 'event',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        level: level as Prisma.LogLevel,
      })),
      errorFormat: 'pretty',
      datasources: {
        // Named `db` to match prisma-election/schema/schema.prisma, which keeps
        // that name so the 38 `@db.*` native-type attributes in the copied
        // model files resolve — Prisma namespaces them by datasource name.
        db: { url: url.toString() },
      },
    })

    enableQueryLogging &&
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

    try {
      await client.$connect()
    } catch (err) {
      // Two different failures wear the same catch, and storing the client is
      // right for only one of them.
      //
      // Prisma raises PrismaClientInitializationError for both, so the class
      // alone cannot tell them apart — `errorCode` can. A reachability
      // failure carries a P-code (P1001 "can't reach database server") and is
      // transient: Aurora was cold, the next query reconnects, so keep the
      // client. A packaging or configuration fault — a missing query engine
      // binary, an unparseable URL — carries no code and can never succeed,
      // so rethrow and leave `activeClient` unset. `.instance` then names the
      // real problem instead of every query dying on the same opaque engine
      // error, which is how a missing engine reached preview and failed 116
      // E2E tests on specs that touch no election data.
      const unrecoverable =
        err instanceof Prisma.PrismaClientInitializationError && !err.errorCode
      if (unrecoverable) {
        throw err
      }
      // Error, not debug: boot still succeeds by design, so this line is the
      // only signal that election routes are degraded.
      this.logger.error(
        { err },
        'election-db connect failed; retrying lazily on first query',
      )
    }
    return client
  }
}
