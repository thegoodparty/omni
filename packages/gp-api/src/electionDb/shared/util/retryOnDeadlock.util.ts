import { Prisma } from '@/generated/election-prisma'

const DEADLOCK_SQLSTATE = '40P01'
const MAX_RETRIES = 2
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
])

// The nightly election-api swap (gp-data-platform) takes ACCESS EXCLUSIVE
// locks on every election table, and a read that joins two of them can land in
// a lock cycle with it. Postgres aborts the reader with 40P01 and says the
// statement is safe to retry. Prisma wraps it as an unknown request error, so
// the SQLSTATE is only visible in the message.
export function isDeadlock(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientUnknownRequestError &&
    err.message.includes(DEADLOCK_SQLSTATE)
  )
}

// Reads only. This client is read-only and opens no interactive transactions,
// so replaying a single statement is always a full retry.
export async function retryReadOperation({
  operation,
  args,
  query,
}: {
  operation: string
  args: unknown
  query: (args: unknown) => Promise<unknown>
}): Promise<unknown> {
  const retryable = READ_OPERATIONS.has(operation)
  for (let attempt = 0; ; attempt++) {
    try {
      return await query(args)
    } catch (err) {
      if (!retryable || !isDeadlock(err) || attempt >= MAX_RETRIES) throw err
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
    }
  }
}

export const retryReadOnDeadlock = Prisma.defineExtension({
  name: 'retryReadOnDeadlock',
  query: { $allOperations: retryReadOperation },
})
