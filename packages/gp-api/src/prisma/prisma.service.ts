import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Prisma, PrismaClient } from '../generated/prisma'
import { PinoLogger } from 'nestjs-pino'

const enableQueryLogging = process.env.ENABLE_QUERY_LOGGING === 'true'

// The listener below was already gated, but the log LEVEL was not: with
// LOG_LEVEL=debug in prod the engine kept emitting a query event per statement
// with nobody listening. Gating both means the engine stops producing them.
const PRISMA_LOG_LEVELS = [
  'info',
  'warn',
  'error',
  ...(enableQueryLogging ? ['query' as Prisma.LogLevel] : []),
]

@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'query'>
  implements OnModuleInit, OnModuleDestroy
{
  constructor(private readonly logger: PinoLogger) {
    super({
      log: PRISMA_LOG_LEVELS.map((level) => ({
        emit: 'event',
        // Prisma log level from string config — Prisma types the config array loosely
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        level: level as Prisma.LogLevel,
      })),
      errorFormat: 'pretty',
    })
    this.logger.setContext(PrismaService.name)
  }

  async onModuleInit() {
    await this.$connect()

    enableQueryLogging &&
      this.$on('query', (event: Prisma.QueryEvent) => {
        this.logger.debug(
          {
            query: event.query,
            params: event.params,
            durationMs: event.duration,
          },
          'Completed SQL Query',
        )
      })
  }

  async onModuleDestroy() {
    await this.$disconnect()
  }
}
