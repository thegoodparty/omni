import { Prisma } from '@/generated/prisma'

// Turns capture off for the rest of a transaction: the next statement that
// needs to write rows without handlers (a backfill, a repair, a test's
// fixtures) wraps them in this. Local to the transaction, so it ends with it.
//
// Several tables' backfills in one transaction take it once. A bare UPDATE
// outside a transaction still captures: SET LOCAL with no transaction is the
// session's until it ends, which is a connection pool's lifetime.
export const skipChangeEvents = async (
  tx: Prisma.TransactionClient,
): Promise<void> => {
  await tx.$executeRaw`SET LOCAL app.skip_change_events = 'on'`
}
