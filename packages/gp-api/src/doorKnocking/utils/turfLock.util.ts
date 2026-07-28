import { Prisma } from '../../generated/prisma'

// Two-int form of pg_advisory_xact_lock: (namespace, turfId). 'dk' in ASCII.
const TURF_LOCK_NAMESPACE = 25707

// Serializes knock against turf update/delete (and knock against knock) per
// turf. Auto-releases on commit/rollback/crash. $executeRaw, not $queryRaw
// (the void return can't be deserialized); ::int casts because Prisma binds
// numbers as bigint and the two-argument lock form is (int4, int4).
export const lockTurf = (
  tx: Prisma.TransactionClient,
  turfId: number,
): Promise<number> =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(${TURF_LOCK_NAMESPACE}::int, ${turfId}::int)`
