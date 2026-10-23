import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'vitest'
import { mintProposalKey } from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import { OutreachStatus, OutreachType } from '../../generated/prisma'

const service = useTestService()

describe('outreach proposal routes', () => {
  let orgSlug: string
  let proposalKey: string

  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    orgSlug = `eo-proposal-${suffix}`
    await service.prisma.organization.create({
      data: { slug: orgSlug, ownerId: service.user.id },
    })
    proposalKey = mintProposalKey(`conversation-${suffix}`, `tool-${suffix}`)
  })

  const allowFailure = () => ({
    headers: { 'x-organization-slug': orgSlug },
    validateStatus: () => true,
  })

  describe('GET /v1/outreach/by-proposal-key/:proposalKey', () => {
    it('404s for a key nothing has been sent under', async () => {
      const res = await service.client.get(
        `/v1/outreach/by-proposal-key/${proposalKey}`,
        allowFailure(),
      )

      expect(res.status).toBe(HttpStatus.NOT_FOUND)
    })

    // The probe must not become an existence oracle for another office's
    // sends: an unowned key answers exactly the way an unused one does.
    it('404s for a key that belongs to another organization', async () => {
      const otherSlug = `eo-proposal-other-${Date.now()}`
      await service.prisma.organization.create({
        data: { slug: otherSlug, ownerId: service.user.id },
      })
      await service.prisma.outreach.create({
        data: {
          campaignId: null,
          organizationSlug: otherSlug,
          outreachType: OutreachType.nativePhoneBanking,
          proposalKey,
        },
      })

      const res = await service.client.get(
        `/v1/outreach/by-proposal-key/${proposalKey}`,
        allowFailure(),
      )

      expect(res.status).toBe(HttpStatus.NOT_FOUND)
    })

    // A Serve text's day lives only here, with `date` null, and the card
    // reads it to say when the text goes out.
    it("returns a Serve text's scheduled day", async () => {
      await service.prisma.outreach.create({
        data: {
          campaignId: null,
          organizationSlug: orgSlug,
          outreachType: OutreachType.text,
          status: OutreachStatus.in_progress,
          scheduledLocalDate: '2026-10-27',
          proposalKey,
        },
      })

      const res = await service.client.get(
        `/v1/outreach/by-proposal-key/${proposalKey}`,
        allowFailure(),
      )

      expect(res.status).toBe(HttpStatus.OK)
      expect(res.data).toMatchObject({
        status: OutreachStatus.in_progress,
        date: null,
        scheduledLocalDate: '2026-10-27',
      })
    })
  })
})
