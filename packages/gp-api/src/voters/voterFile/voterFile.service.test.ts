import { FastifyReply } from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Organization } from '../../generated/prisma'
import { GetVoterFileSchema } from './schemas/GetVoterFile.schema'
import { VoterFileService } from './voterFile.service'

describe('VoterFileService', () => {
  let service: VoterFileService
  let mockContactsService: {
    countVoterFilePeople: ReturnType<typeof vi.fn>
    downloadVoterFilePeople: ReturnType<typeof vi.fn>
  }

  const organization = { slug: 'campaign-1' } as Organization
  const res = {} as FastifyReply

  beforeEach(() => {
    mockContactsService = {
      countVoterFilePeople: vi.fn().mockResolvedValue(42),
      downloadVoterFilePeople: vi.fn().mockResolvedValue(undefined),
    }
    service = new VoterFileService(mockContactsService as never)
  })

  it('counts through people-api with the resolved filter input', async () => {
    const count = await service.getCount(organization, {
      type: 'full',
      countOnly: true,
    } as GetVoterFileSchema)

    expect(count).toBe(42)
    expect(mockContactsService.countVoterFilePeople).toHaveBeenCalledWith(
      {},
      false,
      organization,
    )
  })

  it('resolves the p2p outreach type to the sms population', async () => {
    await service.getCount(organization, {
      type: 'p2p',
      countOnly: true,
    } as GetVoterFileSchema)

    expect(mockContactsService.countVoterFilePeople).toHaveBeenCalledWith(
      { hasCellPhone: true },
      false,
      organization,
    )
  })

  it('resolves campaign task types through TASK_TO_TYPE_MAP', async () => {
    await service.getCount(organization, {
      type: 'phoneBanking',
      countOnly: true,
    } as GetVoterFileSchema)

    expect(mockContactsService.countVoterFilePeople).toHaveBeenCalledWith(
      { hasLandline: true },
      false,
      organization,
    )
  })

  it('resolves a custom channel to its population rule', async () => {
    await service.getCount(organization, {
      type: 'custom',
      countOnly: true,
      customFilters: {
        channel: 'Door Knocking',
        filters: ['party_republican'],
      },
    } as GetVoterFileSchema)

    expect(mockContactsService.countVoterFilePeople).toHaveBeenCalledWith(
      { partyRepublican: true },
      true,
      organization,
    )
  })

  it('streams the CSV through people-api with the resolved filter input', async () => {
    await service.streamCsv(
      organization,
      {
        type: 'sms',
        customFilters: { filters: ['audience_likelyVoters'] },
      } as GetVoterFileSchema,
      res,
    )

    expect(mockContactsService.downloadVoterFilePeople).toHaveBeenCalledWith(
      { audienceLikelyVoters: true, hasCellPhone: true },
      false,
      organization,
      res,
    )
  })
})
