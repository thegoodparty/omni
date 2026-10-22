import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import {
  CivicPanelStatus,
  ContactStatusField,
  ManagedCivicPanelStatus,
  Organization,
  Prisma,
} from '../../generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import {
  CENSUS_COMPOSITION_SOURCE,
  type CensusCompositionSource,
} from '@/priorities/services/censusComposition'
import {
  civicPanelInviteCriteria,
  civicPanelInviteListName,
  inviteLean,
  textInviteSize,
} from '../utils/civicPanelInvite.util'
import { panelSteering, type PanelMix } from '../utils/civicPanelSteering.util'
import { ContactsService } from './contacts.service'

const WAVE_SELECT = {
  id: true,
  wave: true,
  voterFileFilterId: true,
  steeredToward: true,
  outreach: { select: { id: true } },
  sentAt: true,
  createdAt: true,
} satisfies Prisma.ManagedPanelWaveSelect

export type ManagedPanelWaveRow = Prisma.ManagedPanelWaveGetPayload<{
  select: typeof WAVE_SELECT
}>

export type ManagedPanelWaveDraw =
  // A new wave, drawn and saved; `size` is the residents its list holds.
  | { outcome: 'drawn'; wave: ManagedPanelWaveRow; size: number }
  // A wave not yet sent already exists, so nothing new was drawn.
  | { outcome: 'pending'; wave: ManagedPanelWaveRow; size: number }
  // Nobody is left who could be invited by text.
  | { outcome: 'exhausted' }
  | { outcome: 'goal_reached'; members: number }
  | { outcome: 'out_of_free_texts' }
  | { outcome: 'not_building'; status: ManagedCivicPanelStatus }

const TEXT = 'text' as const

// Draws a managed civic panel's next texts-only wave: sized to the members
// still missing, steered toward the groups the panel trails, and frozen as a
// hidden invite list. It sends nothing; the daily job makes the send. See
// the contacts AGENTS.md, "Managed civic panel".
@Injectable()
export class ManagedPanelWaveDrawService extends createPrismaBase(
  MODELS.ManagedPanelWave,
) {
  constructor(
    private readonly contactsService: ContactsService,
    private readonly contactStatusService: ContactStatusService,
    private readonly contactInteractionTextService: ContactInteractionTextService,
    private readonly voterFileFilterService: VoterFileFilterService,
    @Inject(CENSUS_COMPOSITION_SOURCE)
    private readonly census: CensusCompositionSource,
  ) {
    super()
  }

  async drawNextWave(enrollmentId: string): Promise<ManagedPanelWaveDraw> {
    const enrollment = await this.client.managedCivicPanel.findUnique({
      where: { id: enrollmentId },
      select: {
        status: true,
        goalMembers: true,
        freeTextCap: true,
        freeTextsUsed: true,
        organization: true,
      },
    })
    if (!enrollment) {
      throw new NotFoundException('Managed civic panel not found')
    }
    if (enrollment.status !== ManagedCivicPanelStatus.building) {
      return { outcome: 'not_building', status: enrollment.status }
    }
    const pending = await this.pendingWave(enrollmentId)
    if (pending) return pending
    const organization = enrollment.organization
    const memberIds = await this.contactStatusService.personIdsByFieldValue(
      organization.slug,
      ContactStatusField.civic_panel,
      [CivicPanelStatus.member],
    )
    const gap = enrollment.goalMembers - memberIds.length
    if (gap <= 0) return { outcome: 'goal_reached', members: memberIds.length }
    const freeTextsLeft = enrollment.freeTextCap - enrollment.freeTextsUsed
    if (freeTextsLeft <= 0) return { outcome: 'out_of_free_texts' }

    const criteria = civicPanelInviteCriteria(TEXT)
    const exclude = await this.excludedPersonIds(organization.slug)
    const reachable = await this.contactsService.countWithin(
      organization,
      criteria,
      exclude,
    )
    const size = Math.min(textInviteSize(gap, reachable), freeTextsLeft)
    if (size <= 0) return { outcome: 'exhausted' }

    const steering = panelSteering({
      members: memberIds.length,
      mix: await this.mixOf(organization, memberIds),
    })
    const latest = await this.model.aggregate({
      where: { enrollmentId },
      _max: { wave: true },
    })
    const wave = (latest._max.wave ?? 0) + 1
    const personIds =
      (await this.contactsService.drawListSample(organization, criteria, {
        size,
        seedKey: `managed-panel:${enrollmentId}:${wave}`,
        excludePersonIds: exclude,
        weights: steering.weights ?? undefined,
      })) ?? []
    if (personIds.length === 0) return { outcome: 'exhausted' }

    const list = await this.voterFileFilterService.create(
      organization.slug,
      {
        ...criteria,
        name: civicPanelInviteListName({ channel: TEXT, position: 1, wave }),
        sample: { size: personIds.length },
        civicPanelInvite: true,
      },
      null,
      personIds,
    )
    // Serialized per enrollment, and re-checked under the lock: two draws
    // that both passed the check above must not each add a wave.
    const created = await this.client.$transaction(async (tx) => {
      await this.lockEnrollment(tx, enrollmentId)
      const unsent = await tx.managedPanelWave.findFirst({
        where: { enrollmentId, sentAt: null },
        select: { id: true },
      })
      if (unsent) return null
      return tx.managedPanelWave.create({
        data: {
          enrollmentId,
          wave,
          voterFileFilterId: list.id,
          steeredToward: inviteLean(TEXT, steering),
        },
        select: WAVE_SELECT,
      })
    })
    if (created) {
      return { outcome: 'drawn', wave: created, size: personIds.length }
    }
    // Another draw made the wave first; its list is the wave's.
    await this.client.voterFileFilter.delete({ where: { id: list.id } })
    const winner = await this.pendingWave(enrollmentId)
    if (!winner) throw new Error('The managed panel wave could not be drawn')
    return winner
  }

  private lockEnrollment(tx: Prisma.TransactionClient, enrollmentId: string) {
    const lockKey = `managed_civic_panel:${enrollmentId}`
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`
  }

  private async pendingWave(
    enrollmentId: string,
  ): Promise<ManagedPanelWaveDraw | null> {
    const wave = await this.model.findFirst({
      where: { enrollmentId, sentAt: null },
      orderBy: { wave: Prisma.SortOrder.asc },
      select: WAVE_SELECT,
    })
    if (!wave) return null
    const size =
      wave.voterFileFilterId === null
        ? 0
        : await this.client.voterFileFilterSampleMember.count({
            where: { voterFileFilterId: wave.voterFileFilterId },
          })
    return { outcome: 'pending', wave, size }
  }

  // Who no wave may draw: anyone an earlier wave drew, anyone a build plan
  // step drew (unless it was skipped untouched, as the plan reads it), and
  // anyone who opted out of the office's texts. Members, people who left,
  // anyone already invited and anyone reached in the rest window are left
  // out by the invite criteria.
  private async excludedPersonIds(organizationSlug: string): Promise<string[]> {
    const [drawn, optedOut] = await Promise.all([
      this.client.voterFileFilterSampleMember.findMany({
        where: {
          voterFileFilter: {
            organizationSlug,
            OR: [
              { managedPanelWaves: { some: {} } },
              {
                civicPanelBuildStep: {
                  is: {
                    OR: [{ skippedAt: null }, { startedAt: { not: null } }],
                  },
                },
              },
            ],
          },
        },
        select: { personId: true },
      }),
      this.contactInteractionTextService.findOptedOutPersonIds(
        organizationSlug,
      ),
    ])
    return [...new Set([...drawn.map((row) => row.personId), ...optedOut])]
  }

  // The members' census cells beside the district's. Nobody on the panel,
  // or a failed read, leans nowhere.
  private async mixOf(
    organization: Organization,
    memberIds: string[],
  ): Promise<PanelMix | null> {
    if (memberIds.length === 0) return null
    try {
      const district =
        await this.contactsService.resolveEligibleDistrict(organization)
      return await this.census.weightingInputs({
        ...district,
        personIds: memberIds,
      })
    } catch {
      return null
    }
  }
}
