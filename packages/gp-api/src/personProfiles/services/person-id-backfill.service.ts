import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { isUniqueConstraintError } from '@/prisma/util/prismaErrors.util'
import { ElectionsService } from '@/elections/services/elections.service'
import { UsersService } from '@/users/services/users.service'
import { Prisma, User } from '../../generated/prisma'
import { MarketingRevalidationService } from './marketing-revalidation.service'
import {
  PersonIdDriftResult,
  recordPersonIdDrift,
} from '../observability/person-profiles.metrics'

// Per-run cap for the reconcile backstop. The lazy GET /mine path links active
// users on demand, so the cron only needs to sweep a bounded batch of the
// scoped cohort whose users never open the editor — never the whole table.
const DEFAULT_RECONCILE_LIMIT = 500

// Which table a repoint would have collided on, for the operator who has to
// unpick it. Null means the move is clear.
type RepointBlocker = 'user' | 'profile' | 'removal' | null

/**
 * Pulls the person↔user link from election-api and writes it onto gp-api's own
 * `User.person_id`. The data platform populates only election-api's
 * `person.gp_api_user_id`; gp-api reads it here and owns the write to its own
 * DB — no data-team code ever writes to gp-api. Additive: until the ETL
 * populates the column every path is a graceful no-op and `canCreate` behaves
 * exactly as today.
 */
@Injectable()
export class PersonIdBackfillService extends createPrismaBase(MODELS.User) {
  constructor(
    private readonly elections: ElectionsService,
    private readonly usersService: UsersService,
    private readonly revalidation: MarketingRevalidationService,
  ) {
    super()
  }

  /**
   * If the user already has a personId, return it without calling election-api.
   * Otherwise best-effort resolve the civics link and write it to
   * `User.person_id`. NEVER throws — it runs inside GET /mine, so any failure
   * (election-api down, unique-constraint clash) leaves the user unlinked and
   * returns their current personId (null), i.e. identical to today's behavior.
   */
  async linkUserIfMissing(user: User): Promise<string | null> {
    if (user.personId) return user.personId
    try {
      const personId = await this.elections.getPersonIdByGpApiUserId(user.id)
      if (!personId) return null
      try {
        await this.usersService.updateUser({ id: user.id }, { personId })
      } catch (error) {
        // User.person_id is @unique. The linkage is 1:1, so another user
        // already owning this personId means upstream data is inconsistent.
        // Skip the write and leave THIS user unlinked — returning the resolved
        // id would unlock the editor (canCreate) while POST still 409s on a
        // null owner.personId.
        if (!isUniqueConstraintError(error)) throw error
        this.logger.warn(
          { error, userId: user.id, personId },
          'person_id already owned by another user; leaving user unlinked',
        )
        return user.personId ?? null
      }
      return personId
    } catch (error) {
      this.logger.warn(
        { error, userId: user.id },
        'person_id backfill failed; leaving user unlinked',
      )
      return user.personId ?? null
    }
  }

  /**
   * Bounded backstop for the lazy /mine path. Scoped to users who plausibly
   * have a canonical person — those with a Win campaign or a Serve
   * elected-office record — and hard-capped by `limit`, so we never scan or
   * hammer election-api for the entire users table.
   *
   * TODO: this always takes the lowest-id slice, so if the linkable
   * null-personId cohort ever exceeds `limit` the tail is only reached by the
   * lazy /mine path. Add a cursor/rotation if that cohort grows past the cap.
   */
  async reconcileNullPersonIds(
    limit: number = DEFAULT_RECONCILE_LIMIT,
  ): Promise<{ scanned: number; linked: number }> {
    const users = await this.model.findMany({
      where: {
        personId: null,
        OR: [{ campaigns: { some: {} } }, { electedOffices: { some: {} } }],
      },
      orderBy: { id: 'asc' },
      take: limit,
    })

    let linked = 0
    for (const user of users) {
      const personId = await this.linkUserIfMissing(user)
      if (personId) linked += 1
    }

    this.logger.info(
      { scanned: users.length, linked, limit },
      'person_id reconcile pass complete',
    )
    return { scanned: users.length, linked }
  }

  /**
   * Re-resolve one already-linked user and, if the data platform has since
   * merged them onto a different canonical Person, carry every gp-api row that
   * keys off the old id across to the new one.
   *
   * `linkUserIfMissing` writes the link exactly once and never looks again, so
   * without this a re-resolution upstream strands us pointing at an id the
   * spine no longer publishes: the profile overlay stops joining (the page goes
   * blank) and, worse, a takedown stops being honored because `isRemoved`
   * matches on the retired id while the person renders under the new one.
   *
   * Only ever acts on a concrete, *different* id. `getPersonIdByGpApiUserId`
   * returns null both for "no link upstream" and for "the call failed" — it
   * swallows its own errors — so treating null as an unlink would tear down the
   * whole cohort's links the first time election-api has a bad minute.
   */
  async resyncLinkedUser(user: User): Promise<PersonIdDriftResult> {
    const from = user.personId
    if (!from) return this.recordDrift('unchanged')

    const to = await this.elections.getPersonIdByGpApiUserId(user.id)
    if (!to) return this.recordDrift('unresolved')
    if (to === from) return this.recordDrift('unchanged')

    let blocker: RepointBlocker
    try {
      blocker = await this.repoint(user.id, from, to)
    } catch (error) {
      // The pre-checks race with any concurrent write, so a unique violation
      // here is the same situation they screen for, just found later.
      if (isUniqueConstraintError(error)) {
        this.logger.warn(
          { error, userId: user.id, from, to },
          'person_id repoint lost a race to a concurrent write; left unchanged',
        )
        return this.recordDrift('collision')
      }
      this.logger.error(
        { error, userId: user.id, from, to },
        'person_id repoint failed; the link is still stale',
      )
      return this.recordDrift('failed')
    }
    if (blocker) {
      this.logger.warn(
        { userId: user.id, from, to, blocker },
        'person_id drift detected but the destination id is already occupied; left unchanged for manual resolution',
      )
      return this.recordDrift('collision')
    }

    this.logger.info(
      { userId: user.id, from, to },
      'person_id drift repaired; gp-api rows repointed at the surviving person',
    )
    // Both slugs change meaning: the old page must stop serving this person's
    // overlay and the new one must start. Best-effort by contract — never
    // throws, and each page's own revalidate window is the backstop.
    await this.revalidation.revalidatePerson(from)
    await this.revalidation.revalidatePerson(to)
    return this.recordDrift('repointed')
  }

  /**
   * Move every personId-keyed row from one civics id to another, atomically.
   * Returns the table that blocked the move, or null once it has been applied.
   *
   * The destination checks run inside the transaction. The link itself always
   * moves, so a rival owner of the destination id always blocks; the profile
   * and takedown are only checked when this user has one to move, so an
   * unrelated takedown already sitting on the surviving id does not block a
   * profile that simply needs carrying over. A blocked move applies nothing: a
   * half-repointed user (say, the profile moved but the takedown left behind)
   * is worse than one that is uniformly stale, because it reads as healthy.
   */
  private async repoint(
    userId: number,
    from: string,
    to: string,
  ): Promise<RepointBlocker> {
    return this.client.$transaction(async (tx) => {
      const blocker = await this.findBlocker(tx, userId, from, to)
      if (blocker) return blocker

      await tx.user.update({ where: { id: userId }, data: { personId: to } })
      // updateMany, not update: most users have no profile, no takedown and no
      // claim requests, and an absent row is a no-op rather than a P2025.
      await tx.personProfile.updateMany({
        where: { personId: from },
        data: { personId: to },
      })
      await tx.personProfileRemoval.updateMany({
        where: { personId: from },
        data: { personId: to },
      })
      await tx.profileClaimRequest.updateMany({
        where: { personId: from },
        data: { personId: to },
      })
      return null
    })
  }

  private async findBlocker(
    tx: Prisma.TransactionClient,
    userId: number,
    from: string,
    to: string,
  ): Promise<RepointBlocker> {
    // User.person_id is @unique and we always move it, so another owner of the
    // destination id is fatal regardless of what else this user has. Excluding
    // this user is not redundant: the sweep reads the row before opening the
    // transaction, so a concurrent write may already have moved them to `to`,
    // and matching on themselves would report a collision with nobody.
    const otherUser = await tx.user.findFirst({
      where: { personId: to, id: { not: userId } },
      select: { id: true },
    })
    if (otherUser) return 'user'

    // PersonProfile.user_id is @unique, so this user owns at most one profile.
    // If they have one at `from`, anything sitting on `to` is necessarily
    // someone else's.
    const [profileFrom, profileTo] = await Promise.all([
      tx.personProfile.findUnique({
        where: { personId: from },
        select: { id: true },
      }),
      tx.personProfile.findUnique({
        where: { personId: to },
        select: { id: true },
      }),
    ])
    if (profileFrom && profileTo) return 'profile'

    const [removalFrom, removalTo] = await Promise.all([
      tx.personProfileRemoval.findUnique({
        where: { personId: from },
        select: { id: true },
      }),
      tx.personProfileRemoval.findUnique({
        where: { personId: to },
        select: { id: true },
      }),
    ])
    // Two takedown rows cannot be collapsed automatically: each carries its own
    // actor, note and cleared state, and picking one silently discards an audit
    // record we may have to produce later.
    if (removalFrom && removalTo) return 'removal'

    return null
  }

  private recordDrift(result: PersonIdDriftResult): PersonIdDriftResult {
    recordPersonIdDrift(result)
    return result
  }

  /**
   * Companion to `reconcileNullPersonIds` for users who are already linked.
   *
   * Scoped to the cohort where a stale link is actually visible — anyone who
   * owns a profile, or who is under an active takedown — rather than every
   * linked user. That keeps the sweep to a handful of election-api calls while
   * covering both failure modes that reach the public site. A user whose link
   * drifts before they own anything is picked up on the next pass after they
   * create a profile, which is the first moment the staleness can be seen.
   */
  async reconcileDriftedPersonIds(
    limit: number = DEFAULT_RECONCILE_LIMIT,
  ): Promise<{ scanned: number; repointed: number; collisions: number }> {
    const removed = await this.client.personProfileRemoval.findMany({
      where: { clearedAt: null },
      select: { personId: true },
    })
    const removedPersonIds = removed.map((r) => r.personId)

    const users = await this.model.findMany({
      where: {
        personId: { not: null },
        OR: [
          { personProfile: { isNot: null } },
          ...(removedPersonIds.length
            ? [{ personId: { in: removedPersonIds } }]
            : []),
        ],
      },
      orderBy: { id: 'asc' },
      take: limit,
    })

    let repointed = 0
    let collisions = 0
    for (const user of users) {
      const result = await this.resyncLinkedUser(user)
      if (result === 'repointed') repointed += 1
      if (result === 'collision') collisions += 1
    }

    // The cohort is small by construction today. If a run ever fills the cap,
    // the tail is silently never checked, which is exactly the failure this
    // sweep exists to prevent — so say so loudly rather than in a counter.
    if (users.length === limit) {
      this.logger.warn(
        { limit },
        'person_id drift sweep filled its per-run cap; the tail of the cohort went unchecked',
      )
    }
    this.logger.info(
      { scanned: users.length, repointed, collisions, limit },
      'person_id drift pass complete',
    )
    return { scanned: users.length, repointed, collisions }
  }
}
