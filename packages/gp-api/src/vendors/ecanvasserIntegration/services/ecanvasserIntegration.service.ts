import {
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { CreateEcanvasserSchema } from '../schemas/createEcanvasser.schema'
import { UpdateEcanvasserSchema } from '../schemas/updateEcanvasser.schema'
import { CampaignsService } from '../../../campaigns/services/campaigns.service'
import { Ecanvasser, EcanvasserInteraction } from '../../../generated/prisma'
import slugify from 'slugify'
import { subDays, subMinutes } from 'date-fns'
import {
  ECANVASSER_ATTRIBUTION_SERVICE,
  EcanvasserSummary,
} from '../ecanvasserIntegration.types'
import { CrmCampaignsService } from 'src/campaigns/services/crmCampaigns.service'
import { WrapperType } from 'src/shared/types/utility.types'
import { SlackService } from 'src/vendors/slack/services/slack.service'
import { EcanvasserService } from './ecanvasser.service'
// Type-only: the runtime instance is injected via ECANVASSER_ATTRIBUTION_SERVICE
// so this file carries no runtime import of the attribution service, which would
// otherwise close a module-eval cycle (see ecanvasserIntegration.types.ts).
import type { EcanvasserAttributionService } from './ecanvasserAttribution.service'
import { ClerkUserEnricherService } from '@/vendors/clerk/services/clerk-user-enricher.service'

@Injectable()
export class EcanvasserIntegrationService extends createPrismaBase(
  MODELS.Ecanvasser,
) {
  constructor(
    @Inject(forwardRef(() => CampaignsService))
    private readonly campaignsService: WrapperType<CampaignsService>,
    private readonly ecanvasser: EcanvasserService,
    @Inject(forwardRef(() => CrmCampaignsService))
    private readonly crm: WrapperType<CrmCampaignsService>,
    private slack: SlackService,
    private readonly clerkEnricher: ClerkUserEnricherService,
    @Inject(ECANVASSER_ATTRIBUTION_SERVICE)
    private readonly attribution: EcanvasserAttributionService,
  ) {
    super()
  }

  async create(
    createEcanvasserDto: CreateEcanvasserSchema,
  ): Promise<Ecanvasser> {
    const campaign = await this.campaignsService.findFirstOrThrow({
      where: {
        user: {
          email: createEcanvasserDto.email,
        },
      },
    })

    const ecanvasser = await this.model.create({
      data: {
        campaignId: campaign.id,
        // TODO: We store the apiKey encrypted.
        apiKey: createEcanvasserDto.apiKey,
      },
    })

    await this.sync(campaign.id)

    return ecanvasser
  }

  async findByCampaignId(campaignId: number) {
    return await this.model.findFirst({
      where: { campaignId },
      include: {
        contacts: true,
        houses: true,
        interactions: true,
      },
    })
  }

  async mine(campaignId: number): Promise<Omit<Ecanvasser, 'apiKey'> | null> {
    return this.model.findFirst({
      where: { campaignId },
      omit: { apiKey: true },
    })
  }

  private groupInteractionsByDay(interactions: EcanvasserInteraction[]) {
    const recentInteractions = interactions.filter(
      (interaction) => interaction.createdAt > subDays(new Date(), 30),
    )

    return recentInteractions.reduce<Record<string, Record<string, number>>>(
      (acc, interaction) => {
        const date = interaction.date.toISOString().split('T')[0]
        if (!acc[date]) {
          acc[date] = { count: 0 }
        }
        acc[date].count++
        if (!acc[date][interaction.status]) {
          acc[date][interaction.status] = 0
        }
        acc[date][interaction.status]++
        return acc
      },
      {},
    )
  }

  private calculateAverageRating(
    interactions: EcanvasserInteraction[],
  ): number {
    const ratedInteractions = interactions.filter((i) => i.rating)
    if (ratedInteractions.length === 0) return 0

    const sum = ratedInteractions.reduce(
      (total, interaction) => total + (interaction.rating || 0),
      0,
    )
    return sum / ratedInteractions.length
  }

  private groupInteractionsByStatus(
    interactions: EcanvasserInteraction[],
  ): Record<string, number> {
    return interactions.reduce(
      (acc, interaction) => {
        const key = slugify(interaction.status, { lower: true })
        acc[key] = (acc[key] || 0) + 1
        return acc
      },
      {} as Record<string, number>,
    )
  }

  private groupInteractionsByRatings(
    interactions: EcanvasserInteraction[],
  ): Record<string, number> {
    return interactions.reduce(
      (acc, interaction) => {
        const key = interaction.rating ? `${interaction.rating}` : 'unrated'
        acc[key] = (acc[key] || 0) + 1
        return acc
      },
      {} as Record<string, number>,
    )
  }

  async summary(campaignId: number) {
    const ecanvasser = await this.model.findFirstOrThrow({
      where: { campaignId },
      include: {
        contacts: true,
        houses: true,
        interactions: true,
      },
    })

    const interactionsByDay = this.groupInteractionsByDay(
      ecanvasser.interactions,
    )

    return {
      totalContacts: ecanvasser.contacts.length,
      totalHouses: ecanvasser.houses.length,
      totalInteractions: ecanvasser.interactions.length,
      averageRating: this.calculateAverageRating(ecanvasser.interactions),
      groupedRatings: this.groupInteractionsByRatings(ecanvasser.interactions),
      interactions: this.groupInteractionsByStatus(ecanvasser.interactions),
      interactionsByDay,
      lastSync: ecanvasser.lastSync,
    }
  }

  async update(
    campaignId: number,
    updateEcanvasserDto: UpdateEcanvasserSchema,
  ): Promise<Ecanvasser> {
    const ecanvasser = await this.findByCampaignId(campaignId)

    if (!ecanvasser) {
      throw new NotFoundException('Ecanvasser integration not found')
    }

    return this.model.update({
      where: { id: ecanvasser.id },
      data: updateEcanvasserDto,
    })
  }

  async remove(campaignId: number): Promise<void> {
    const ecanvasser = await this.findByCampaignId(campaignId)

    if (!ecanvasser) {
      throw new NotFoundException('Ecanvasser integration not found')
    }

    await this.model.delete({
      where: { id: ecanvasser.id },
    })
  }

  async sync(campaignId: number, force?: boolean): Promise<Ecanvasser> {
    const ecanvasser = await this.findByCampaignId(campaignId)

    if (!ecanvasser) {
      throw new NotFoundException('Ecanvasser integration not found')
    }
    // Check if we should sync based on last sync time
    if (!force && ecanvasser.lastSync) {
      const thirtyMinutesAgo = subMinutes(new Date(), 30)
      const lastSyncDate = new Date(ecanvasser.lastSync)
      if (lastSyncDate > thirtyMinutesAgo) {
        return ecanvasser // Return existing data if last sync was less than 30 minutes ago
      }
    }

    const startDate = ecanvasser.lastSync || undefined

    try {
      const contacts = await this.ecanvasser.fetchContacts(
        ecanvasser.apiKey,
        startDate,
      )

      const houses = await this.ecanvasser.fetchHouses(
        ecanvasser.apiKey,
        startDate,
      )

      const interactions = await this.ecanvasser.fetchInteractions(
        ecanvasser.apiKey,
        startDate,
      )

      // The full sync deletes every child row and re-populates it. Run that
      // delete and the repopulating upserts in one transaction so a mid-loop
      // failure rolls back to the pre-sync rows instead of leaving the tables
      // emptied (the outer catch only logs and resets lastSync). The delta sync
      // (startDate set) skips the delete and only upserts, so its writes are
      // independently safe and don't need the wrapping transaction, but routing
      // both through the same block keeps the write path single.
      const updated = await this.client.$transaction(
        async (tx) => {
          if (!startDate) {
            await tx.ecanvasserContact.deleteMany({
              where: { ecanvasserId: ecanvasser.id },
            })
            await tx.ecanvasserHouse.deleteMany({
              where: { ecanvasserId: ecanvasser.id },
            })
            await tx.ecanvasserInteraction.deleteMany({
              where: { ecanvasserId: ecanvasser.id },
            })
          }

          // Upsert each record keyed on (ecanvasserId, externalId) rather than
          // appending. The delta sync overlaps its window on each run, so the
          // same eCanvasser record can be re-fetched; upserting updates it in
          // place instead of inserting a duplicate that violates the unique
          // index. A falsy id (the API client casts responses without a runtime
          // id check) would collapse every such record onto external_id 0 and
          // silently overwrite, so skip those rather than corrupt the row.
          for (const contact of contacts) {
            if (!contact.id) continue
            const data = {
              firstName: contact.first_name,
              lastName: contact.last_name,
              type: contact.type,
              gender: contact.gender || null,
              dateOfBirth: contact.date_of_birth
                ? new Date(contact.date_of_birth)
                : null,
              yearOfBirth: contact.year_of_birth?.toString() || null,
              houseId: contact.house_id || null,
              uniqueIdentifier: contact.unique_identifier || null,
              organization: contact.organization || null,
              volunteer: contact.volunteer,
              deceased: contact.deceased,
              donor: contact.donor,
              homePhone: contact.contact_details?.home || null,
              mobilePhone: contact.contact_details?.mobile || null,
              email: contact.contact_details?.email || null,
              actionId: contact.action_id || null,
              lastInteractionId: contact.last_interaction_id || null,
              createdBy: contact.created_by || 0,
            }
            await tx.ecanvasserContact.upsert({
              where: {
                ecanvasserId_externalId: {
                  ecanvasserId: ecanvasser.id,
                  externalId: contact.id,
                },
              },
              create: {
                ...data,
                externalId: contact.id,
                ecanvasserId: ecanvasser.id,
              },
              update: data,
            })
          }

          for (const house of houses) {
            if (!house.id) continue
            const data = {
              address: house.address,
              latitude: house.latitude || null,
              longitude: house.longitude || null,
            }
            await tx.ecanvasserHouse.upsert({
              where: {
                ecanvasserId_externalId: {
                  ecanvasserId: ecanvasser.id,
                  externalId: house.id,
                },
              },
              create: {
                ...data,
                externalId: house.id,
                ecanvasserId: ecanvasser.id,
              },
              update: data,
            })
          }

          for (const interaction of interactions) {
            if (!interaction.id) continue
            const data = {
              type: interaction.type,
              status: interaction.status?.name ?? 'Unknown',
              contactId: interaction.contact_id || 0,
              createdBy: interaction.created_by || 0,
              date: interaction.created_at,
              rating: interaction.rating || null,
            }
            await tx.ecanvasserInteraction.upsert({
              where: {
                ecanvasserId_externalId: {
                  ecanvasserId: ecanvasser.id,
                  externalId: interaction.id,
                },
              },
              create: {
                ...data,
                externalId: interaction.id,
                ecanvasserId: ecanvasser.id,
              },
              update: data,
            })
          }

          // Stamp lastSync inside the same transaction as the data writes so a
          // crash can't leave lastSync stale relative to what was persisted — a
          // stale lastSync would re-enter the full-sync deleteMany branch on the
          // next run and briefly empty all three child tables.
          return tx.ecanvasser.update({
            where: { id: ecanvasser.id },
            data: {
              lastSync: new Date(),
              error: null,
            },
            include: { contacts: true, interactions: true },
          })
        },
        { timeout: 60_000 },
      )
      await this.crm.trackCampaign(campaignId)
      // Emit per-voter door-knock attribution from the freshly-synced rows. This
      // is a best-effort side effect of the sync: idempotent, and its expected
      // failures (ineligible campaign, People-API down) are handled inside the
      // service. Guard the call so an unexpected attribution failure (e.g. a DB
      // error) is logged without marking the eCanvasser sync itself failed or
      // rolling lastSync back.
      const campaign = await this.campaignsService.findFirst({
        where: { id: campaignId },
        include: { organization: true },
      })
      if (campaign?.organization) {
        try {
          await this.attribution.attributeDoorKnocking(
            campaignId,
            campaign.organization,
            updated.contacts,
            updated.interactions,
          )
        } catch (error) {
          this.logger.error(
            { error, campaignId },
            'Door-knock attribution failed; eCanvasser sync result is unaffected',
          )
        }
      }
      return updated
    } catch (error) {
      this.logger.error({ error }, 'Failed to sync with ecanvasserIntegration')
      await this.slack.errorMessage({
        message: `Failed to sync with ecanvasser for campaign ${ecanvasser.campaignId}`,
        error,
      })
      return this.model.update({
        where: { id: ecanvasser.id },
        data: {
          lastSync: startDate,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      })
    }
  }

  async findAll(): Promise<EcanvasserSummary[]> {
    const ecanvassers = await this.model.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        campaign: {
          select: {
            id: true,
            user: {
              select: {
                clerkId: true,
                email: true,
              },
            },
          },
        },
        contacts: true,
        houses: true,
        interactions: true,
      },
    })

    const users = ecanvassers
      .map((e) => e.campaign?.user)
      .filter((u): u is NonNullable<typeof u> => u != null)
    const enriched = await this.clerkEnricher.enrichUsers(users)
    let idx = 0
    for (const ecanvasser of ecanvassers) {
      if (ecanvasser.campaign?.user) {
        ecanvasser.campaign.user = enriched[idx++]
      }
    }

    return ecanvassers.map((ecanvasser) => ({
      contacts: ecanvasser.contacts.length,
      houses: ecanvasser.houses.length,
      interactions: ecanvasser.interactions.length,
      email: ecanvasser.campaign?.user?.email ?? null,
      campaignId: ecanvasser.campaign?.id,
      lastSync: ecanvasser.lastSync,
      error: ecanvasser.error,
    }))
  }

  async syncAll(): Promise<void> {
    const ecanvassers = await this.model.findMany()

    for (const ecanvasser of ecanvassers) {
      try {
        await this.sync(ecanvasser.campaignId, true)
      } catch (error) {
        this.logger.error(
          { error },
          `Failed to sync ecanvasser for campaign ${ecanvasser.campaignId}`,
        )
      }
    }
  }
}
