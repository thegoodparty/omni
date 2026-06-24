import { useTestService } from '@/test-service'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EcanvasserIntegrationService } from './ecanvasserIntegration.service'
import { EcanvasserService } from './ecanvasser.service'
import { CrmCampaignsService } from '@/campaigns/services/crmCampaigns.service'
import {
  ApiEcanvasserContact,
  ApiEcanvasserHouse,
  ApiEcanvasserInteraction,
} from '../ecanvasserIntegration.types'

const service = useTestService()

const apiContact = (
  overrides: Partial<ApiEcanvasserContact> & { id: number },
): ApiEcanvasserContact => ({
  first_name: 'Jane',
  last_name: 'Doe',
  type: 'Resident',
  volunteer: false,
  deceased: false,
  donor: false,
  contact_details: {},
  created_by: 0,
  ...overrides,
})

const apiHouse = (
  overrides: Partial<ApiEcanvasserHouse> & { id: number },
): ApiEcanvasserHouse =>
  ({
    address: '1 Main St',
    latitude: 1,
    longitude: 2,
    ...overrides,
  }) as ApiEcanvasserHouse

const apiInteraction = (
  overrides: Partial<ApiEcanvasserInteraction> & { id: number },
): ApiEcanvasserInteraction => ({
  type: 'Canvass',
  status: { name: 'Active' },
  contact_id: 0,
  created_by: 0,
  created_at: '2026-03-01T12:00:00.000Z',
  ...overrides,
})

describe('EcanvasserIntegrationService.sync', () => {
  let integration: EcanvasserIntegrationService
  let ecanvasserApi: EcanvasserService
  let crm: CrmCampaignsService

  const seedEcanvasser = async (slug: string) => {
    const organization = await service.prisma.organization.create({
      data: { slug: `org-${slug}`, ownerId: service.user.id },
    })
    const campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug,
        organizationSlug: organization.slug,
      },
    })
    const ecanvasser = await service.prisma.ecanvasser.create({
      data: { campaignId: campaign.id, apiKey: 'test-key' },
    })
    return { campaignId: campaign.id, ecanvasserId: ecanvasser.id }
  }

  beforeEach(() => {
    integration = service.app.get(EcanvasserIntegrationService)
    ecanvasserApi = service.app.get(EcanvasserService)
    crm = service.app.get(CrmCampaignsService)
    vi.spyOn(crm, 'trackCampaign').mockResolvedValue(undefined)
  })

  it('updates a re-fetched record in place instead of duplicating', async () => {
    const { campaignId, ecanvasserId } = await seedEcanvasser('upsert-window')

    // First sync (full): the integration has no lastSync yet.
    vi.spyOn(ecanvasserApi, 'fetchContacts').mockResolvedValueOnce([
      apiContact({ id: 100, last_name: 'First' }),
    ])
    vi.spyOn(ecanvasserApi, 'fetchHouses').mockResolvedValueOnce([
      apiHouse({ id: 500, address: 'First Ave' }),
    ])
    vi.spyOn(ecanvasserApi, 'fetchInteractions').mockResolvedValueOnce([
      apiInteraction({ id: 900, contact_id: 100, rating: 3 }),
    ])

    await integration.sync(campaignId, true)

    // Second sync (delta, forced): the same eCanvasser ids come back with
    // changed fields — the overlapping-window re-fetch the unique index used to
    // turn into a P2002 once the constraint was added.
    vi.spyOn(ecanvasserApi, 'fetchContacts').mockResolvedValueOnce([
      apiContact({ id: 100, last_name: 'Updated' }),
    ])
    vi.spyOn(ecanvasserApi, 'fetchHouses').mockResolvedValueOnce([
      apiHouse({ id: 500, address: 'Updated Ave' }),
    ])
    vi.spyOn(ecanvasserApi, 'fetchInteractions').mockResolvedValueOnce([
      apiInteraction({ id: 900, contact_id: 100, rating: 5 }),
    ])

    await integration.sync(campaignId, true)

    const contacts = await service.prisma.ecanvasserContact.findMany({
      where: { ecanvasserId },
    })
    const houses = await service.prisma.ecanvasserHouse.findMany({
      where: { ecanvasserId },
    })
    const interactions = await service.prisma.ecanvasserInteraction.findMany({
      where: { ecanvasserId },
    })

    expect(contacts).toHaveLength(1)
    expect(contacts[0]).toMatchObject({ externalId: 100, lastName: 'Updated' })
    expect(houses).toHaveLength(1)
    expect(houses[0]).toMatchObject({ externalId: 500, address: 'Updated Ave' })
    expect(interactions).toHaveLength(1)
    expect(interactions[0]).toMatchObject({ externalId: 900, rating: 5 })
  })

  it('enforces unique (ecanvasserId, externalId) on each model', async () => {
    const { ecanvasserId } = await seedEcanvasser('unique-guard')

    await service.prisma.ecanvasserContact.create({
      data: {
        ecanvasserId,
        externalId: 100,
        firstName: 'A',
        lastName: 'B',
        type: 'Resident',
        createdBy: 0,
      },
    })

    await expect(
      service.prisma.ecanvasserContact.create({
        data: {
          ecanvasserId,
          externalId: 100,
          firstName: 'C',
          lastName: 'D',
          type: 'Resident',
          createdBy: 0,
        },
      }),
    ).rejects.toThrow()
  })
})
