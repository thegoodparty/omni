import { BadGatewayException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ElectionApiDistrictService } from './electionApiDistrict.service'

const DISTRICT_ID = '0e5bafca-93a9-86a5-2522-f373979720df'

describe('ElectionApiDistrictService', () => {
  let findUnique: ReturnType<typeof vi.fn>
  let service: ElectionApiDistrictService

  beforeEach(() => {
    findUnique = vi.fn()
    service = new ElectionApiDistrictService(
      { findUnique } as never,
      {
        setContext: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      } as never,
    )
  })

  // The election tables name these columns for their L2 origin; the voter
  // path wants the people-db spelling, and the two tables agree on the
  // values.
  it('maps the L2 column names onto the district shape', async () => {
    findUnique.mockResolvedValue({
      id: DISTRICT_ID,
      state: 'WY',
      L2DistrictType: 'City_Ward',
      L2DistrictName: 'CHEYENNE CITY WARD 1',
      registeredVoters: 8604,
    })

    const district = await service.findDistrictById(DISTRICT_ID)

    expect(district).toEqual({
      id: DISTRICT_ID,
      type: 'City_Ward',
      name: 'CHEYENNE CITY WARD 1',
      state: 'WY',
    })
  })

  it('looks the district up by its primary key', async () => {
    findUnique.mockResolvedValue({
      id: DISTRICT_ID,
      state: 'WY',
      L2DistrictType: 'City_Ward',
      L2DistrictName: 'CHEYENNE CITY WARD 1',
    })

    await service.findDistrictById(DISTRICT_ID)

    expect(findUnique).toHaveBeenCalledWith({ where: { id: DISTRICT_ID } })
  })

  // A missing district is the caller's domain error, and the message matches
  // what the people-db lookup produced so nothing downstream has to change.
  it('turns a missing row into NotFound', async () => {
    findUnique.mockResolvedValue(null)

    await expect(service.findDistrictById(DISTRICT_ID)).rejects.toThrow(
      NotFoundException,
    )
  })

  // Prisma raises on a non-uuid value for a @db.Uuid column, so the id is
  // checked before the query rather than after.
  it('treats a malformed id as a missing district', async () => {
    await expect(service.findDistrictById('not-a-uuid')).rejects.toThrow(
      NotFoundException,
    )
    expect(findUnique).not.toHaveBeenCalled()
  })

  // Everything else must not be mistaken for "no such district" -- that
  // would silently empty a real audience.
  it('does not mistake a read failure for a missing district', async () => {
    findUnique.mockRejectedValue(new Error('connection lost'))

    await expect(service.findDistrictById(DISTRICT_ID)).rejects.toThrow(
      'connection lost',
    )
  })

  it('refuses a row missing the columns it reads', async () => {
    findUnique.mockResolvedValue({ id: DISTRICT_ID, state: 'WY' })

    await expect(service.findDistrictById(DISTRICT_ID)).rejects.toThrow(
      BadGatewayException,
    )
  })
})
