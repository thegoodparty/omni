import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { isUniqueConstraintError } from '@/prisma/util/prismaErrors.util'
import { ElectionsService } from '@/elections/services/elections.service'
import { UsersService } from '@/users/services/users.service'
import { User } from '../../generated/prisma'

// Per-run cap for the reconcile backstop. The lazy GET /mine path links active
// users on demand, so the cron only needs to sweep a bounded batch of the
// scoped cohort whose users never open the editor — never the whole table.
const DEFAULT_RECONCILE_LIMIT = 500

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
}
