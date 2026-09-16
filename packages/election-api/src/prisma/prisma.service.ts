import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Prisma, PrismaClient } from '../generated/prisma'

// No 'query'. Subscribing to it logged every statement Prisma ran, full text
// with every column named and its bound parameter values, and this service is
// query-dense enough that those lines were ~60% of its log lines and around
// half of everything the whole platform ingested. LOG_LEVEL is 'debug' in
// deployed environments (deploy/index.ts), so this was on in production.
// Re-adding it means re-adding both the volume and parameter values in logs.
const PRISMA_LOG_LEVELS: Prisma.LogLevel[] = ['info', 'warn', 'error']

/**
 * Builds a DATABASE_URL with connection pool parameters appended.
 * Prisma uses `connection_limit` and `pool_timeout` as URL query params
 * to control its internal connection pool.
 *
 * Defaults: connection_limit=10, pool_timeout=20 (seconds).
 * Override via PRISMA_CONNECTION_LIMIT and PRISMA_POOL_TIMEOUT env vars.
 */
function buildDatabaseUrl(): string {
  const baseUrl = process.env.DATABASE_URL || ''
  const connectionLimit =
    parseInt(process.env.PRISMA_CONNECTION_LIMIT || '', 10) || 10
  const poolTimeout = parseInt(process.env.PRISMA_POOL_TIMEOUT || '', 10) || 20

  const separator = baseUrl.includes('?') ? '&' : '?'
  return `${baseUrl}${separator}connection_limit=${connectionLimit}&pool_timeout=${poolTimeout}`
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      datasources: {
        db: {
          url: buildDatabaseUrl(),
        },
      },
      log: PRISMA_LOG_LEVELS.map((level) => ({
        emit: 'event',
        level,
      })),
      errorFormat: 'pretty',
    })
  }

  async onModuleInit() {
    await this.$connect()
  }

  async onModuleDestroy() {
    await this.$disconnect()
  }
}
