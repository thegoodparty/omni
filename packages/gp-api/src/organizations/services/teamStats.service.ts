import { Injectable } from '@nestjs/common'
import { max as latestOf } from 'date-fns'
import { TeamMemberStats, TeamStatsResponse } from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { Organization } from '../../generated/prisma'
import { OrganizationMembershipService } from './organizationMembership.service'

// One group per actor: the row count IS doors-knocked/calls-made (every row
// is one logged interaction), and _max.occurredAt is that actor's newest one
// in this table. Shared shape for both channels' groupBy result.
type ActorActivityGroup = {
  actorUserId: number | null
  _count: number
  _max: { occurredAt: Date | null }
}

const groupsByActorId = (
  groups: ActorActivityGroup[],
): Map<number, ActorActivityGroup> => {
  const byActorId = new Map<number, ActorActivityGroup>()
  for (const group of groups) {
    // Filtered out at the query (actorUserId: { not: null }); this is just
    // narrowing the nullable groupBy field type, not a real runtime case.
    if (group.actorUserId !== null) {
      byActorId.set(group.actorUserId, group)
    }
  }
  return byActorId
}

@Injectable()
export class TeamStatsService extends createPrismaBase(
  MODELS.ContactInteractionDoorKnock,
) {
  constructor(private readonly membership: OrganizationMembershipService) {
    super()
  }

  // Never touches Clerk: current membership is Postgres-only (owner +
  // OrganizationMembership rows), the same resolution OrganizationTeamService
  // .listTeam uses for its members half. A former member's interaction rows
  // still carry their actorUserId, but dropping them here (rather than a
  // "former members" bucket) is a locked v1 scoping decision.
  async getTeamStats(organization: Organization): Promise<TeamStatsResponse> {
    const [memberships, doorKnockGroups, phoneBankingGroups] =
      await Promise.all([
        this.membership.model.findMany({
          where: { organizationSlug: organization.slug },
          select: { userId: true },
        }),
        this.model.groupBy({
          by: ['actorUserId'],
          where: {
            organizationSlug: organization.slug,
            actorUserId: { not: null },
          },
          _count: true,
          _max: { occurredAt: true },
        }),
        this.client.contactInteractionPhoneBanking.groupBy({
          by: ['actorUserId'],
          where: {
            organizationSlug: organization.slug,
            actorUserId: { not: null },
          },
          _count: true,
          _max: { occurredAt: true },
        }),
      ])

    const currentMemberIds = new Set<number>([
      organization.ownerId,
      ...memberships.map((membership) => membership.userId),
    ])
    const doorKnocksByActorId = groupsByActorId(doorKnockGroups)
    const callsByActorId = groupsByActorId(phoneBankingGroups)

    const stats: TeamMemberStats[] = [...currentMemberIds].map((userId) => {
      const doorKnocks = doorKnocksByActorId.get(userId)
      const calls = callsByActorId.get(userId)
      const doorsKnocked = doorKnocks?._count ?? 0
      const callsMade = calls?._count ?? 0
      const lastKnockAt = doorKnocks?._max.occurredAt ?? null
      const lastCallAt = calls?._max.occurredAt ?? null

      return {
        userId,
        doorsKnocked,
        callsMade,
        totalLogged: doorsKnocked + callsMade,
        lastActivityAt:
          lastKnockAt && lastCallAt
            ? latestOf([lastKnockAt, lastCallAt])
            : (lastKnockAt ?? lastCallAt),
      }
    })

    return { stats }
  }
}
