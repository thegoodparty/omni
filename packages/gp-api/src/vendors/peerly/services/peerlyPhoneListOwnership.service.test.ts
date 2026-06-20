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

    it('fails closed (403) and never claims when no ownership record exists', async () => {
      // Peerly list ids are sequential/account-global, so a missing record can
      // be a freshly-uploaded list mid-flight. Claiming-on-miss would let an
      // attacker race the uploader — so deny, never create.
      findUnique.mockResolvedValue(null)

      await expect(
        service.assertCampaignOwnsList(7, 42),
      ).rejects.toBeInstanceOf(ForbiddenException)
      expect(create).not.toHaveBeenCalled()
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

    it('propagates upsert errors (ownership is required for fail-closed access)', async () => {
      upsert.mockRejectedValue(new Error('db down'))

      await expect(service.recordUpload(7, 'tok-abc')).rejects.toThrow(
        'db down',
      )
    })
  })

  describe('linkListId', () => {
    it('fills a still-null listId on the token row', async () => {
      updateMany.mockResolvedValue({ count: 1 })

      await service.linkListId('tok-abc', 42)

      expect(updateMany).toHaveBeenCalledWith({
        where: { token: 'tok-abc', listId: null },
        data: { listId: 42, updatedAt: expect.any(Date) },
      })
    })

    it('swallows and logs update errors so the status check is not broken', async () => {
      updateMany.mockRejectedValue(new Error('db down'))

      await expect(service.linkListId('tok-abc', 42)).resolves.toBeUndefined()
    })

    it('resolves without throwing when no upload row matches (count 0)', async () => {
      updateMany.mockResolvedValue({ count: 0 })

      await expect(service.linkListId('tok-abc', 42)).resolves.toBeUndefined()
    })
  })
})
