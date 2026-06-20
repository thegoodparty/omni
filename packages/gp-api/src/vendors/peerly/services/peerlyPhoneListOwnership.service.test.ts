import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenException } from '@nestjs/common'
import { PeerlyPhoneListOwnershipService } from './peerlyPhoneListOwnership.service'

describe('PeerlyPhoneListOwnershipService', () => {
  let service: PeerlyPhoneListOwnershipService
  let findUnique: ReturnType<typeof vi.fn>
  let create: ReturnType<typeof vi.fn>
  let upsert: ReturnType<typeof vi.fn>
  let updateMany: ReturnType<typeof vi.fn>

  beforeEach(() => {
    findUnique = vi.fn()
    create = vi.fn()
    upsert = vi.fn()
    updateMany = vi.fn()
    service = new PeerlyPhoneListOwnershipService()
    Object.defineProperty(service, '_prisma', {
      value: {
        peerlyPhoneList: { findUnique, create, upsert, updateMany },
      },
    })
    Object.defineProperty(service, 'logger', {
      value: { warn: vi.fn(), error: vi.fn() },
    })
  })

  describe('assertCampaignOwnsList', () => {
    it('resolves when the caller campaign owns the list', async () => {
      findUnique.mockResolvedValue({ id: 1, campaignId: 7, listId: 42 })

      await expect(
        service.assertCampaignOwnsList(7, 42),
      ).resolves.toBeUndefined()
      expect(create).not.toHaveBeenCalled()
    })

    it('throws ForbiddenException when a different campaign owns the list', async () => {
      // The core IDOR: caller 7 trying to use campaign 99's curated list.
      findUnique.mockResolvedValue({ id: 1, campaignId: 99, listId: 42 })

      await expect(
        service.assertCampaignOwnsList(7, 42),
      ).rejects.toBeInstanceOf(ForbiddenException)
      expect(create).not.toHaveBeenCalled()
    })

    it('claims the list for the caller (trust-on-first-use) when no record exists', async () => {
      // Grandfather path: a list uploaded before the table existed and not
      // captured by backfill. Claim it for the caller rather than block them.
      findUnique.mockResolvedValue(null)
      create.mockResolvedValue({ id: 2, campaignId: 7, listId: 42 })

      await expect(
        service.assertCampaignOwnsList(7, 42),
      ).resolves.toBeUndefined()
      expect(create).toHaveBeenCalledWith({
        data: { campaignId: 7, listId: 42 },
      })
    })

    it('rejects when a concurrent claim by another campaign wins the race', async () => {
      findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 3, campaignId: 99, listId: 42 })
      create.mockRejectedValue(new Error('unique violation'))

      await expect(
        service.assertCampaignOwnsList(7, 42),
      ).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('allows when the racing claim was the caller’s own', async () => {
      findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 4, campaignId: 7, listId: 42 })
      create.mockRejectedValue(new Error('unique violation'))

      await expect(
        service.assertCampaignOwnsList(7, 42),
      ).resolves.toBeUndefined()
    })
  })

  describe('recordUpload', () => {
    it('upserts ownership keyed by token', async () => {
      upsert.mockResolvedValue({})

      await service.recordUpload(7, 'tok-abc')

      expect(upsert).toHaveBeenCalledWith({
        where: { token: 'tok-abc' },
        create: { campaignId: 7, token: 'tok-abc' },
        update: {},
      })
    })

    it('swallows and logs upsert errors so the upload is not broken', async () => {
      upsert.mockRejectedValue(new Error('db down'))

      await expect(service.recordUpload(7, 'tok-abc')).resolves.toBeUndefined()
    })
  })

  describe('linkListId', () => {
    it('fills a still-null listId on the token row', async () => {
      updateMany.mockResolvedValue({ count: 1 })

      await service.linkListId('tok-abc', 42)

      expect(updateMany).toHaveBeenCalledWith({
        where: { token: 'tok-abc', listId: null },
        data: { listId: 42 },
      })
    })

    it('swallows and logs update errors so the status check is not broken', async () => {
      updateMany.mockRejectedValue(new Error('db down'))

      await expect(service.linkListId('tok-abc', 42)).resolves.toBeUndefined()
    })
  })
})
