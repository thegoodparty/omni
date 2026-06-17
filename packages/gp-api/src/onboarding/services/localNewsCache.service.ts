import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'

export type LocalNewsJurisdiction = {
  office: string
  city: string
  state: string
}

// Postgres advisory-lock namespace serializing local-news pending-slot claims.
// Distinct from the elected-office (918_277) and campaign (918_273/274/276)
// keys so these locks never collide; the second arg is a hash of the
// jurisdiction so concurrent claims for the SAME (office, city, state) block
// each other while different jurisdictions proceed in parallel.
const LOCAL_NEWS_PENDING_LOCK_KEY = 918_278

// Stable signed 32-bit hash of a jurisdiction, used as the second
// pg_advisory_xact_lock argument (which must fit in an int4). Case-insensitive
// so trivial casing differences map to the same lock.
const jurisdictionLockId = (jurisdiction: LocalNewsJurisdiction): number => {
  const key =
    `${jurisdiction.office}|${jurisdiction.city}|${jurisdiction.state}`.toLowerCase()
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (Math.imul(31, hash) + key.charCodeAt(i)) | 0
  }
  return hash
}

@Injectable()
export class LocalNewsCacheService extends createPrismaBase(
  MODELS.LocalNewsCache,
) {
  findByJurisdiction(jurisdiction: LocalNewsJurisdiction) {
    return this.findFirst({ where: jurisdiction })
  }

  /**
   * Runs `fn` while holding a transaction-scoped advisory lock keyed by the
   * jurisdiction, so a read-then-write (e.g. claiming the pending slot) is
   * atomic against concurrent calls for the same (office, city, state). The
   * lock is released automatically when the transaction commits or rolls back.
   */
  async withJurisdictionLock<T>(
    jurisdiction: LocalNewsJurisdiction,
    fn: () => Promise<T>,
  ): Promise<T> {
    const lockId = jurisdictionLockId(jurisdiction)
    return this.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCAL_NEWS_PENDING_LOCK_KEY}::integer, ${lockId}::integer)`
      return fn()
    })
  }
}
