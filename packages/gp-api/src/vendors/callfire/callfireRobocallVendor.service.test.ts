import { BadGatewayException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ROBOCALL_BROADCAST_STATUS } from '@/outreach/vendor/robocallVendor.types'
import { VendorPermanentError } from '@/outreach/vendor/vendorPermanentError'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { CallfireRobocallVendor } from './callfireRobocallVendor'
import { NoInventoryError } from './noInventoryError'
import { CallfireBroadcastService } from './services/callfireBroadcast.service'
import { CallfireContactsService } from './services/callfireContacts.service'
import { CallfireDncService } from './services/callfireDnc.service'
import { CallfireMediaService } from './services/callfireMedia.service'
import { CallfireNumbersService } from './services/callfireNumbers.service'
import { CallfireResultsService } from './services/callfireResults.service'

// The poll would otherwise wait 4s between attempts; collapse it.
vi.mock('@/shared/util/sleep.util', () => ({
  sleep: vi.fn().mockResolvedValue(undefined),
}))

const csvBytes = () => new TextEncoder().encode('phone\n+18005550100\n').buffer

const listStatus = (over: Record<string, unknown> = {}) => ({
  listId: '77',
  status: 'ACTIVE',
  size: 2,
  isReady: true,
  isFailed: false,
  ...over,
})

describe('CallfireRobocallVendor', () => {
  let numbers: { rentNumber: ReturnType<typeof vi.fn> }
  let media: { uploadSound: ReturnType<typeof vi.fn> }
  let contacts: {
    createListFromCsv: ReturnType<typeof vi.fn>
    getListStatus: ReturnType<typeof vi.fn>
  }
  let broadcast: {
    createBroadcast: ReturnType<typeof vi.fn>
    launchBroadcast: ReturnType<typeof vi.fn>
    abortBroadcast: ReturnType<typeof vi.fn>
    getBroadcastStatus: ReturnType<typeof vi.fn>
  }
  let results: { getCompletedCount: ReturnType<typeof vi.fn> }
  let dnc: { partitionByDnc: ReturnType<typeof vi.fn> }
  let vendor: CallfireRobocallVendor

  beforeEach(() => {
    numbers = { rentNumber: vi.fn() }
    media = { uploadSound: vi.fn() }
    contacts = { createListFromCsv: vi.fn(), getListStatus: vi.fn() }
    broadcast = {
      createBroadcast: vi.fn(),
      launchBroadcast: vi.fn(),
      abortBroadcast: vi.fn(),
      getBroadcastStatus: vi.fn(),
    }
    results = { getCompletedCount: vi.fn() }
    dnc = { partitionByDnc: vi.fn() }
    vendor = new CallfireRobocallVendor(
      numbers as unknown as CallfireNumbersService,
      media as unknown as CallfireMediaService,
      contacts as unknown as CallfireContactsService,
      broadcast as unknown as CallfireBroadcastService,
      results as unknown as CallfireResultsService,
      dnc as unknown as CallfireDncService,
      createMockLogger(),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => csvBytes(),
      }),
    )
  })

  describe('rentNumber', () => {
    it('rents with the area code and maps a missing region to null', async () => {
      numbers.rentNumber.mockResolvedValue({ phoneNumber: '+18005551234' })

      const result = await vendor.rentNumber({ areaCode: '512' })

      expect(numbers.rentNumber).toHaveBeenCalledWith({ areaCode: '512' })
      expect(result).toEqual({ phoneNumber: '+18005551234', region: null })
    })

    it('falls back to a national number when the area code has no inventory', async () => {
      numbers.rentNumber
        .mockRejectedValueOnce(
          new NoInventoryError('No CallFire local number available'),
        )
        .mockResolvedValueOnce({ phoneNumber: '+18885559999', region: 'CA' })

      const result = await vendor.rentNumber({ areaCode: '512' })

      // First tries the prefix, then degrades to a no-prefix national rental.
      expect(numbers.rentNumber).toHaveBeenCalledTimes(2)
      expect(numbers.rentNumber).toHaveBeenNthCalledWith(1, { areaCode: '512' })
      expect(numbers.rentNumber).toHaveBeenNthCalledWith(2, { areaCode: '' })
      expect(result).toEqual({ phoneNumber: '+18885559999', region: 'CA' })
    })

    it('propagates a transient error without a billable national retry', async () => {
      // A 429 / auth / timeout is a plain BadGatewayException, NOT a
      // NoInventoryError — it must propagate for an upstream retry rather than
      // silently triggering a real national number purchase.
      numbers.rentNumber.mockRejectedValue(
        new BadGatewayException('CallFire throttled'),
      )

      await expect(
        vendor.rentNumber({ areaCode: '512' }),
      ).rejects.toBeInstanceOf(BadGatewayException)
      expect(numbers.rentNumber).toHaveBeenCalledTimes(1)
      expect(numbers.rentNumber).toHaveBeenCalledWith({ areaCode: '512' })
    })

    it('propagates a permanent 4xx failure without a national retry', async () => {
      numbers.rentNumber.mockRejectedValue(
        new VendorPermanentError('bad prefix'),
      )

      await expect(
        vendor.rentNumber({ areaCode: '512' }),
      ).rejects.toBeInstanceOf(VendorPermanentError)
      expect(numbers.rentNumber).toHaveBeenCalledTimes(1)
    })

    it('propagates a national-retry failure', async () => {
      numbers.rentNumber
        .mockRejectedValueOnce(
          new NoInventoryError('No CallFire local number available'),
        )
        .mockRejectedValueOnce(new BadGatewayException('national exhausted'))

      await expect(
        vendor.rentNumber({ areaCode: '512' }),
      ).rejects.toBeInstanceOf(BadGatewayException)
      expect(numbers.rentNumber).toHaveBeenCalledTimes(2)
    })

    it('does not retry when the area-code rental succeeds', async () => {
      numbers.rentNumber.mockResolvedValue({
        phoneNumber: '+18005551234',
        region: 'TX',
      })

      await vendor.rentNumber({ areaCode: '512' })

      expect(numbers.rentNumber).toHaveBeenCalledTimes(1)
    })
  })

  describe('uploadMedia', () => {
    it('uploads the sound and returns the media id', async () => {
      media.uploadSound.mockResolvedValue({ mediaId: '9001' })

      const result = await vendor.uploadMedia({
        file: Buffer.from('audio'),
        fileName: 'clip.mp3',
        mimeType: 'audio/mpeg',
      })

      expect(media.uploadSound).toHaveBeenCalledWith({
        file: expect.any(Buffer),
        fileName: 'clip.mp3',
        mimeType: 'audio/mpeg',
      })
      expect(result).toEqual({ mediaId: '9001' })
    })
  })

  describe('loadAudience', () => {
    it('downloads the CSV, creates the list, and waits for ACTIVE', async () => {
      contacts.createListFromCsv.mockResolvedValue({ listId: '77' })
      contacts.getListStatus
        .mockResolvedValueOnce(
          listStatus({ isReady: false, status: 'VALIDATING' }),
        )
        .mockResolvedValueOnce(listStatus({ size: 2 }))

      const result = await vendor.loadAudience({
        name: 'Robocall audience',
        csvUrl: 'https://s3.example/audience.csv',
        countryIso: 'US',
      })

      expect(fetch).toHaveBeenCalledWith('https://s3.example/audience.csv')
      expect(contacts.createListFromCsv).toHaveBeenCalledWith({
        name: 'Robocall audience',
        file: expect.any(Buffer),
        fileName: 'audience.csv',
        mimeType: 'text/csv',
      })
      // Polled twice: still VALIDATING, then ACTIVE.
      expect(contacts.getListStatus).toHaveBeenCalledTimes(2)
      expect(result).toEqual({ audienceRef: '77', loadedCount: 2 })
    })

    it('fails permanently on a terminal validation failure without polling', async () => {
      contacts.createListFromCsv.mockResolvedValue({ listId: '77' })
      contacts.getListStatus.mockResolvedValue(
        listStatus({ isReady: false, isFailed: true, status: 'IMPORT_FAILED' }),
      )

      await expect(
        vendor.loadAudience({
          name: 'Robocall audience',
          csvUrl: 'https://s3.example/audience.csv',
          countryIso: 'US',
        }),
      ).rejects.toBeInstanceOf(VendorPermanentError)
      // A terminal list-validation failure can never be fixed by retrying —
      // it surfaces as permanent on the first read, not after the poll window.
      expect(contacts.getListStatus).toHaveBeenCalledTimes(1)
    })

    it('tolerates a transient BadGatewayException on one poll attempt and retries', async () => {
      contacts.createListFromCsv.mockResolvedValue({ listId: '77' })
      contacts.getListStatus
        .mockRejectedValueOnce(new BadGatewayException('gateway timeout'))
        .mockResolvedValueOnce(listStatus({ size: 2 }))

      const result = await vendor.loadAudience({
        name: 'Robocall audience',
        csvUrl: 'https://s3.example/audience.csv',
        countryIso: 'US',
      })

      // The transient error is swallowed and the poll retries to ACTIVE.
      expect(contacts.getListStatus).toHaveBeenCalledTimes(2)
      expect(result).toEqual({ audienceRef: '77', loadedCount: 2 })
    })

    it('fails fast on a permanent status error without exhausting the poll window', async () => {
      contacts.createListFromCsv.mockResolvedValue({ listId: '77' })
      contacts.getListStatus.mockRejectedValue(
        new VendorPermanentError('CallFire list 77 not found'),
      )

      await expect(
        vendor.loadAudience({
          name: 'Robocall audience',
          csvUrl: 'https://s3.example/audience.csv',
          countryIso: 'US',
        }),
      ).rejects.toBeInstanceOf(VendorPermanentError)
      // A permanent 4xx propagates on the first attempt — never retried 30x.
      expect(contacts.getListStatus).toHaveBeenCalledTimes(1)
    })

    it('throws when validation never settles within the poll window', async () => {
      contacts.createListFromCsv.mockResolvedValue({ listId: '77' })
      contacts.getListStatus.mockResolvedValue(
        listStatus({ isReady: false, status: 'VALIDATING' }),
      )

      await expect(
        vendor.loadAudience({
          name: 'Robocall audience',
          csvUrl: 'https://s3.example/audience.csv',
          countryIso: 'US',
        }),
      ).rejects.toBeInstanceOf(BadGatewayException)
      // Exhausts the full poll window (LIST_POLL_ATTEMPTS) before failing loudly.
      expect(contacts.getListStatus).toHaveBeenCalledTimes(30)
    })

    it('throws when the CSV download fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 403 }),
      )

      await expect(
        vendor.loadAudience({
          name: 'Robocall audience',
          csvUrl: 'https://s3.example/audience.csv',
          countryIso: 'US',
        }),
      ).rejects.toBeInstanceOf(BadGatewayException)
      expect(contacts.createListFromCsv).not.toHaveBeenCalled()
    })
  })

  describe('createBroadcast', () => {
    it('creates a non-dialing broadcast with the list and never launches', async () => {
      const startingDate = new Date('2026-01-01T15:00:00Z')
      const expirationDate = new Date('2026-01-08T15:00:00Z')
      broadcast.createBroadcast.mockResolvedValue({
        campaignRef: '42',
        startingDate,
        expirationDate,
      })

      const result = await vendor.createBroadcast({
        name: 'Robocall run',
        audienceRef: '77',
        callerId: '+18005551234',
        mediaId: '9001',
        scheduledStart: startingDate,
      })

      expect(broadcast.createBroadcast).toHaveBeenCalledWith({
        name: 'Robocall run',
        fromNumber: '+18005551234',
        liveSoundId: 9001,
        contactListId: '77',
        scheduledStart: startingDate,
      })
      expect(broadcast.launchBroadcast).not.toHaveBeenCalled()
      expect(result).toEqual({
        campaignRef: '42',
        startingDate,
        expirationDate,
      })
    })
  })

  describe('launchBroadcast / abortBroadcast', () => {
    it('delegates launch to the broadcast service', async () => {
      broadcast.launchBroadcast.mockResolvedValue(undefined)

      await vendor.launchBroadcast('42')

      expect(broadcast.launchBroadcast).toHaveBeenCalledWith('42')
    })

    it('delegates abort to the broadcast service', async () => {
      broadcast.abortBroadcast.mockResolvedValue(undefined)

      await vendor.abortBroadcast('42')

      expect(broadcast.abortBroadcast).toHaveBeenCalledWith('42')
    })
  })

  describe('getBroadcastStatus', () => {
    it('returns the neutral status the broadcast service maps', async () => {
      broadcast.getBroadcastStatus.mockResolvedValue(
        ROBOCALL_BROADCAST_STATUS.DIALING,
      )

      const status = await vendor.getBroadcastStatus('42')

      expect(broadcast.getBroadcastStatus).toHaveBeenCalledWith('42')
      expect(status).toBe(ROBOCALL_BROADCAST_STATUS.DIALING)
    })
  })

  describe('getCompletedCount', () => {
    it('delegates the billable count to the results service', async () => {
      results.getCompletedCount.mockResolvedValue({
        connectedCount: 5,
        billableSeconds: 120,
      })

      const count = await vendor.getCompletedCount('42')

      expect(results.getCompletedCount).toHaveBeenCalledWith('42')
      expect(count).toEqual({ connectedCount: 5, billableSeconds: 120 })
    })
  })

  describe('partitionByDnc', () => {
    it('delegates the DNC split to the DNC service', async () => {
      dnc.partitionByDnc.mockResolvedValue({
        callable: ['+18005550100'],
        dnc: ['+18005550101'],
      })

      const result = await vendor.partitionByDnc([
        '+18005550100',
        '+18005550101',
      ])

      expect(dnc.partitionByDnc).toHaveBeenCalledWith([
        '+18005550100',
        '+18005550101',
      ])
      expect(result).toEqual({
        callable: ['+18005550100'],
        dnc: ['+18005550101'],
      })
    })
  })
})
