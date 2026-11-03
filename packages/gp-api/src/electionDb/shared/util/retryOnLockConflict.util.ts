import { Prisma } from '@/generated/election-prisma'

// Postgres SQLSTATEs for losing a lock: a deadlock victim, and a wait that hit
// LOCK_TIMEOUT (set on the connection in electionDb.service.ts). Postgres says
// both are safe to retry.
const LOCK_CONFLICT_SQLSTATES = ['40P01', '55P03']

// The nightly swap holds its locks for a few seconds (5-8s for the whole
// Airflow task, Oct 27 - Nov 2 2026, including worker startup). A read blocked
// by it times out every LOCK_TIMEOUT plus RETRY_DELAY_MS, about 450ms, so 20
// retries keep trying for roughly 9s, which also covers the swap's own 10s
// lock_timeout.
const MAX_RETRIES = 20
const RETRY_DELAY_MS = 250

const READ_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  // Safe only because this client never writes; every raw query is a SELECT.
  '$queryRaw',
])

// Prisma reports a model read's lock error as an unknown request error and a
// raw query's as P2010, so the SQLSTATE is only visible in the message.
export const isLockConflict = (err: unknown): boolean =>
  (err instanceof Prisma.PrismaClientUnknownRequestError ||
    err instanceof Prisma.PrismaClientKnownRequestError) &&
  LOCK_CONFLICT_SQLSTATES.some((code) => err.message.includes(code))

// Reads only. This client is read-only and opens no interactive transactions,
// so replaying a single statement is always a full retry.
export const retryReadOperation = async ({
  operation,
  args,
  query,
}: {
  operation: string
  args: unknown
  query: (args: unknown) => Promise<unknown>
}): Promise<unknown> => {
  const retryable = READ_OPERATIONS.has(operation)
  for (let attempt = 0; ; attempt++) {
    try {
      return await query(args)
    } catch (err) {
      if (!retryable || !isLockConflict(err) || attempt >= MAX_RETRIES) {
        throw err
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
    }
  }
}

export const retryReadOnLockConflict = Prisma.defineExtension({
  name: 'retryReadOnLockConflict',
  query: { $allOperations: retryReadOperation },
})
