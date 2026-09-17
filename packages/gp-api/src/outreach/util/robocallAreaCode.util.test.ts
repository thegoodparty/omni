import { describe, expect, it, vi } from 'vitest'
import { Campaign } from '../../generated/prisma'
import type { AreaCodeFromZipLookup } from './campaignGeography.util'
import {
  areaCodeFromE164UsNumber,
  resolveRobocallAreaCode,
} from './robocallAreaCode.util'

describe('robocallAreaCode.util', () => {
  describe('resolveRobocallAreaCode', () => {
    it('returns the first area code for a campaign zip', async () => {
      const areaCodeFromZipService: AreaCodeFromZipLookup = {
        getAreaCodeFromZip: vi.fn().mockResolvedValue(['512', '737']),
      }

      const result = await resolveRobocallAreaCode(
        { zip: '78634' } as Campaign['details'],
        { areaCodeFromZipService },
      )

      expect(result).toBe('512')
      expect(areaCodeFromZipService.getAreaCodeFromZip).toHaveBeenCalledWith(
        '78634',
      )
    })

    it('strips a ZIP+4 suffix before looking up the area code', async () => {
      const areaCodeFromZipService: AreaCodeFromZipLookup = {
        getAreaCodeFromZip: vi.fn().mockResolvedValue(['512']),
      }

      await resolveRobocallAreaCode(
        { zip: '78634-1234' } as Campaign['details'],
        { areaCodeFromZipService },
      )

      expect(areaCodeFromZipService.getAreaCodeFromZip).toHaveBeenCalledWith(
        '78634',
      )
    })

    it('returns undefined without looking up the zip when the campaign has none', async () => {
      const areaCodeFromZipService: AreaCodeFromZipLookup = {
        getAreaCodeFromZip: vi.fn(),
      }
      const logger = { debug: vi.fn() }

      const result = await resolveRobocallAreaCode({} as Campaign['details'], {
        areaCodeFromZipService,
        logger,
      })

      expect(result).toBeUndefined()
      expect(areaCodeFromZipService.getAreaCodeFromZip).not.toHaveBeenCalled()
      expect(logger.debug).toHaveBeenCalledWith(
        {},
        expect.stringContaining('no zip'),
      )
    })

    it('returns undefined and logs when the zip lookup finds no area code', async () => {
      const areaCodeFromZipService: AreaCodeFromZipLookup = {
        getAreaCodeFromZip: vi.fn().mockResolvedValue(null),
      }
      const logger = { debug: vi.fn() }

      const result = await resolveRobocallAreaCode(
        { zip: '00000' } as Campaign['details'],
        { areaCodeFromZipService, logger },
      )

      expect(result).toBeUndefined()
      expect(logger.debug).toHaveBeenCalledWith(
        { zip: '00000' },
        expect.stringContaining('no known area code'),
      )
    })

    it('returns undefined when the zip lookup returns an empty array', async () => {
      const areaCodeFromZipService: AreaCodeFromZipLookup = {
        getAreaCodeFromZip: vi.fn().mockResolvedValue([]),
      }

      const result = await resolveRobocallAreaCode(
        { zip: '00000' } as Campaign['details'],
        { areaCodeFromZipService },
      )

      expect(result).toBeUndefined()
    })
  })

  describe('areaCodeFromE164UsNumber', () => {
    it('extracts the NPA from an E.164 US number', () => {
      expect(areaCodeFromE164UsNumber('+15125550143')).toBe('512')
    })

    it('extracts the NPA from a number missing the leading +', () => {
      expect(areaCodeFromE164UsNumber('15125550143')).toBe('512')
    })

    it('returns undefined for a malformed number', () => {
      expect(areaCodeFromE164UsNumber('not-a-number')).toBeUndefined()
    })
  })
})
