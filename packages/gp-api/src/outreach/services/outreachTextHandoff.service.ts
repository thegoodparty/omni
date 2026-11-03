import { randomBytes } from 'crypto'
import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common'
import { addMinutes, subMinutes } from 'date-fns'
import {
  AgentHandoffClaimResponse,
  AgentHandoffItem,
} from '@goodparty_org/contracts'
import {
  ManagedCivicPanelStatus,
  OutreachHandoffHandler,
  OutreachHandoffStatus,
  Prisma,
} from '@/generated/prisma'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { getUserFullName } from '@/users/util/users.util'
import { S3Service } from '@/vendors/aws/services/s3.service'
import {
  resolveBucket,
  resolveSendKeyPrefix,
} from '../util/outreachTextCsvLocation.util'

export const HANDOFF_CLAIM_TTL_MINUTES = 20
export const HANDOFF_CSV_URL_TTL_SECONDS = 15 * 60
// Scheduling needs the slot to still be ahead of the swarm's next poll.
const SCHEDULE_MIN_LEAD_MINUTES = 120
const FIRST_SEND_SEQ = 1

const handoffInclude = {
  outreach: {
    select: {
      message: true,
      organizationSlug: true,
      managedPanelWave: { select: { wave: true } },
      _count: { select: { textRecipients: true } },
    },
  },
} satisfies Prisma.OutreachTextHandoffInclude

@Injectable()
export class OutreachTextHandoffService extends createPrismaBase(
  MODELS.OutreachTextHandoff,
) {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly s3: S3Service,
  ) {
    super()
  }

  // The swarm's whole work queue. `claim` filters by the same predicate, so
  // a row that has fallen out of the list cannot be claimed either.
  private dueWhere(now: Date): Prisma.OutreachTextHandoffWhereInput {
    return {
      handler: OutreachHandoffHandler.agent,
      needsHumanAt: null,
      outreach: { managedPanelWave: { isNot: null } },
      OR: [
        {
          status: OutreachHandoffStatus.queued,
          sendAt: { gt: addMinutes(now, SCHEDULE_MIN_LEAD_MINUTES) },
          outreach: {
            managedPanelWave: {
              enrollment: { status: ManagedCivicPanelStatus.building },
            },
          },
        },
        { status: OutreachHandoffStatus.built, mode: 'shadow' },
        {
          status: OutreachHandoffStatus.scheduled,
          repliesDueAt: { lte: now },
          repliesSubmittedAt: null,
        },
      ],
    }
  }

  private unclaimedWhere(now: Date): Prisma.OutreachTextHandoffWhereInput {
    return {
      OR: [
        { claimedAt: null },
        { claimedAt: { lt: subMinutes(now, HANDOFF_CLAIM_TTL_MINUTES) } },
      ],
    }
  }

  async listDue(now: Date): Promise<AgentHandoffItem[]> {
    const rows = await this.model.findMany({
      where: { AND: [this.dueWhere(now), this.unclaimedWhere(now)] },
      include: handoffInclude,
      orderBy: { sendAt: 'asc' },
    })

    return Promise.all(
      rows.map(async (row): Promise<AgentHandoffItem> => {
        const { outreach } = row
        const organization = outreach.organizationSlug
          ? await this.client.organization.findUnique({
              where: { slug: outreach.organizationSlug },
              include: { owner: true },
            })
          : null
        const serve = organization
          ? await this.organizations.resolveServeContext(organization)
          : null
        const city = serve?.l2DistrictName
          ? OrganizationsService.extractCityFromDistrictName(
              serve.l2DistrictName,
            )
          : null
        const name = organization ? getUserFullName(organization.owner) : ''
        const wave = outreach.managedPanelWave?.wave ?? 0
        const action =
          row.status === OutreachHandoffStatus.queued
            ? 'schedule'
            : row.status === OutreachHandoffStatus.built
              ? 'confirm_scheduled'
              : 'export_replies'

        return {
          outreachId: row.outreachId,
          action,
          mode: row.mode === 'auto' ? 'auto' : 'shadow',
          wave,
          official: { name, city, state: serve?.state ?? '' },
          message: outreach.message ?? '',
          recipientCount: outreach._count.textRecipients,
          sendAt: row.sendAt.toISOString(),
          timeZone: row.timeZone,
          campaignName: `[Serve] Civic ${[name, city ?? serve?.state]
            .filter(Boolean)
            .join(' ')} W${wave} #${row.outreachId}`,
          vendorCampaignName: row.vendorCampaignName,
          repliesDueAt: row.repliesDueAt?.toISOString() ?? null,
        }
      }),
    )
  }

  async claim(
    outreachId: number,
    now: Date,
  ): Promise<AgentHandoffClaimResponse> {
    const { count } = await this.model.updateMany({
      where: {
        AND: [{ outreachId }, this.dueWhere(now), this.unclaimedWhere(now)],
      },
      data: {
        claimedAt: now,
        claimToken: randomBytes(32).toString('base64url'),
      },
    })

    if (count === 0) {
      const exists = await this.model.findUnique({
        where: { outreachId },
        select: { id: true },
      })
      if (!exists) {
        throw new NotFoundException(`No hand-off for outreach ${outreachId}`)
      }
      throw new ConflictException(
        `Hand-off for outreach ${outreachId} is claimed, not due, or needs a person`,
      )
    }

    const row = await this.model.findUniqueOrThrow({ where: { outreachId } })
    const claimedAt = row.claimedAt ?? now
    const recipientsCsvUrl = await this.s3.getSignedUrlForViewing(
      resolveBucket(),
      `${resolveSendKeyPrefix()}/${outreachId}-${FIRST_SEND_SEQ}.csv`,
      { expiresIn: HANDOFF_CSV_URL_TTL_SECONDS },
    )

    return {
      claimToken: row.claimToken ?? '',
      recipientsCsvUrl,
      claimExpiresAt: addMinutes(
        claimedAt,
        HANDOFF_CLAIM_TTL_MINUTES,
      ).toISOString(),
    }
  }
}
