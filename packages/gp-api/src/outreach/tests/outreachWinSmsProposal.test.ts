import { HttpStatus } from '@nestjs/common'
import FormData from 'form-data'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AreaCodeFromZipService } from '@/ai/util/areaCodeFromZip.util'
import { CampaignTcrComplianceService } from '@/campaigns/tcrCompliance/services/campaignTcrCompliance.service'
import { CrmCampaignsService } from '@/campaigns/services/crmCampaigns.service'
import { useTestService } from '@/test-service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { GooglePlacesService } from '@/vendors/google/services/google-places.service'
import { PeerlyP2pJobService } from '@/vendors/peerly/services/peerlyP2pJob.service'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { Campaign, OutreachStatus, OutreachType } from '../../generated/prisma'

const service = useTestService()

const PROPOSAL_KEY = '6f1d2c3b-8a4e-4b5f-9c7d-1e2f3a4b5c6d'

const SCRIPT =
  'Hello {first_name}, this is Johnny Goodparty. Vote for me. ' +
  'Paid for by Friends of Johnny. Reply STOP to opt out.'

// The Campaign Manager's card opens Win's text flow, whose draft carries the
// card's key from checkout on. Only a paid text reads as the card sent.
describe('a Win text carrying a proposal key', () => {
  let campaign: Campaign
  let orgSlug: string

  beforeEach(async () => {
    vi.spyOn(service.app.get(SlackService), 'message').mockImplementation(
      vi.fn().mockResolvedValue('ok'),
    )
    vi.spyOn(
      service.app.get(PeerlyP2pJobService),
      'createPeerlyP2pJob',
    ).mockResolvedValue('peerly-job-abc-123')
    vi.spyOn(
      service.app.get(CampaignTcrComplianceService),
      'findFirstOrThrow',
    ).mockImplementation(
      vi.fn().mockResolvedValue({
        id: 'tcr-1',
        campaignId: 999,
        peerlyIdentityId: '11538886',
        status: 'approved',
      }),
    )
    vi.spyOn(
      service.app.get(CrmCampaignsService),
      'getCrmCompanyOwnerName',
    ).mockResolvedValue('Test PA')
    vi.spyOn(
      service.app.get(GooglePlacesService),
      'getAddressByPlaceId',
    ).mockImplementation(vi.fn().mockResolvedValue({ predictions: [] }))
    vi.spyOn(
      service.app.get(AreaCodeFromZipService),
      'getAreaCodeFromZip',
    ).mockResolvedValue(['512'])
    vi.spyOn(service.app.get(S3Service), 'uploadFile').mockResolvedValue(
      'https://test-bucket.s3/fake-image.png',
    )

    orgSlug = `campaign-proposal-${Date.now()}`
    await service.prisma.organization.create({
      data: { slug: orgSlug, ownerId: service.user.id, positionId: 'pos-1' },
    })
    campaign = await service.prisma.campaign.create({
      data: {
        id: 999,
        organizationSlug: orgSlug,
        userId: service.user.id,
        slug: 'jane-doe',
        isPro: true,
        details: { state: 'TX', zip: '78634' },
        data: { hubspotId: 'hub-1' },
        aiContent: {},
      },
    })
  })

  const headers = (slug = orgSlug) => ({ 'x-organization-slug': slug })

  const submitDraft = (
    overrides: { proposalKey?: string; draftOutreachId?: number } = {},
  ) => {
    const form = new FormData()
    form.append('campaignId', String(campaign.id))
    form.append('outreachType', OutreachType.p2p)
    form.append('status', OutreachStatus.pending)
    form.append('script', SCRIPT)
    form.append('phoneListId', '3180213')
    form.append('date', new Date(Date.now() + 7 * 86400_000).toISOString())
    form.append('draft', 'true')
    form.append('textCount', '200')
    if (overrides.proposalKey) form.append('proposalKey', overrides.proposalKey)
    if (overrides.draftOutreachId) {
      form.append('draftOutreachId', String(overrides.draftOutreachId))
    }
    form.append('file', Buffer.from('fake-image-bytes'), {
      filename: 'image.png',
      contentType: 'image/png',
    })
    return service.client.post('/v1/outreach', form, {
      headers: { ...headers(), ...form.getHeaders() },
      validateStatus: () => true,
    })
  }

  const probe = (slug = orgSlug) =>
    service.client.get(`/v1/outreach/by-proposal-key/${PROPOSAL_KEY}`, {
      headers: headers(slug),
      validateStatus: () => true,
    })

  it('persists the key on the unpaid draft, which reads as not sent', async () => {
    const res = await submitDraft({ proposalKey: PROPOSAL_KEY })

    expect(res.status).toBe(HttpStatus.CREATED)
    const row = await service.prisma.outreach.findUniqueOrThrow({
      where: { proposalKey: PROPOSAL_KEY },
    })
    expect(row.campaignId).toBe(campaign.id)
    expect(row.status).toBe(OutreachStatus.pending_payment)
    expect((await probe()).status).toBe(HttpStatus.NOT_FOUND)
  })

  it('moves the key to a fresh draft when an unpaid one holds it', async () => {
    const first = await submitDraft({ proposalKey: PROPOSAL_KEY })
    const second = await submitDraft({ proposalKey: PROPOSAL_KEY })

    expect(second.status).toBe(HttpStatus.CREATED)
    const holder = await service.prisma.outreach.findUniqueOrThrow({
      where: { proposalKey: PROPOSAL_KEY },
    })
    expect(holder.id).not.toBe((first.data as { id: number }).id)
    expect(holder.id).toBe((second.data as { id: number }).id)
    expect(
      await service.prisma.outreach.count({
        where: { campaignId: campaign.id },
      }),
    ).toBe(2)
  })

  it('reads as sent once paid, and refuses the key again', async () => {
    await submitDraft({ proposalKey: PROPOSAL_KEY })
    await service.prisma.outreach.update({
      where: { proposalKey: PROPOSAL_KEY },
      data: { status: OutreachStatus.pending },
    })

    const found = await probe()
    expect(found.status).toBe(HttpStatus.OK)
    expect((found.data as { campaignId: number }).campaignId).toBe(campaign.id)

    const again = await submitDraft({ proposalKey: PROPOSAL_KEY })
    expect(again.status).toBe(HttpStatus.CONFLICT)
    expect(JSON.stringify(again.data)).toContain(
      'This proposal has already been sent',
    )
  })

  it('reads a build-mode draft under the key as not sent', async () => {
    await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        organizationSlug: orgSlug,
        outreachType: OutreachType.p2p,
        status: OutreachStatus.draft,
        proposalKey: PROPOSAL_KEY,
      },
    })

    expect((await probe()).status).toBe(HttpStatus.NOT_FOUND)
  })

  it('lets a text that never went out be started again from the card', async () => {
    await submitDraft({ proposalKey: PROPOSAL_KEY })
    await service.prisma.outreach.update({
      where: { proposalKey: PROPOSAL_KEY },
      data: { status: OutreachStatus.canceled },
    })

    expect((await probe()).status).toBe(HttpStatus.NOT_FOUND)

    const again = await submitDraft({ proposalKey: PROPOSAL_KEY })
    expect(again.status).toBe(HttpStatus.CREATED)
    const holder = await service.prisma.outreach.findUniqueOrThrow({
      where: { proposalKey: PROPOSAL_KEY },
    })
    expect(holder.id).toBe((again.data as { id: number }).id)
  })

  it("refuses a key another organization's outreach holds", async () => {
    const otherSlug = `eo-proposal-other-${Date.now()}`
    await service.prisma.organization.create({
      data: { slug: otherSlug, ownerId: service.user.id },
    })
    await service.prisma.outreach.create({
      data: {
        campaignId: null,
        organizationSlug: otherSlug,
        outreachType: OutreachType.text,
        status: OutreachStatus.pending_payment,
        proposalKey: PROPOSAL_KEY,
      },
    })

    const res = await submitDraft({ proposalKey: PROPOSAL_KEY })

    expect(res.status).toBe(HttpStatus.CONFLICT)
    expect(JSON.stringify(res.data)).toContain('Proposal key is already in use')
    expect(
      await service.prisma.outreach.count({
        where: { campaignId: campaign.id },
      }),
    ).toBe(0)
  })

  it('refuses a key on a resume', async () => {
    const res = await submitDraft({
      proposalKey: PROPOSAL_KEY,
      draftOutreachId: 1,
    })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })
})
