import { HttpService } from '@nestjs/axios'
import { BadGatewayException } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { PinoLogger } from 'nestjs-pino'
import { of, throwError } from 'rxjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { ElectionApiTokenService } from '@/vendors/clerk/services/electionApiToken.service'
import { ElectedOfficeSupportApiService } from './electedOfficeSupportApi.service'

const OFFICE = 'a0000000-0000-0000-0000-000000000001'
const AUTH_HEADER = { Authorization: 'Bearer mt_test' }
const ROW = {
  electedOfficeId: OFFICE,
  supportConstituents: 2893,
  totalConstituents: 4084,
}

describe('ElectedOfficeSupportApiService', () => {
  let service: ElectedOfficeSupportApiService
  let mockHttpGet: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    process.env.ELECTION_API_URL = 'http://test-election-api'
    mockHttpGet = vi.fn()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ElectedOfficeSupportApiService,
        { provide: PinoLogger, useValue: createMockLogger() },
        { provide: HttpService, useValue: { get: mockHttpGet } },
        {
          provide: ElectionApiTokenService,
          useValue: { authHeader: vi.fn().mockResolvedValue(AUTH_HEADER) },
        },
      ],
    }).compile()
    service = module.get<ElectedOfficeSupportApiService>(
      ElectedOfficeSupportApiService,
    )
  })

  it('GETs elected-office-support and returns the parsed row (strips extras)', async () => {
    mockHttpGet.mockReturnValue(
      of({
        data: { ...ROW, createdAt: '2026-06-18T00:00:00.000Z' },
        status: 200,
      }),
    )

    const result = await service.getByElectedOfficeId(OFFICE)

    expect(mockHttpGet).toHaveBeenCalledWith(
      'http://test-election-api/v1/elected-office-support',
      { params: { electedOfficeId: OFFICE }, headers: AUTH_HEADER },
    )
    expect(result).toEqual(ROW)
  })

  it('returns null on 404 (no row yet)', async () => {
    mockHttpGet.mockReturnValue(
      throwError(() => ({ isAxiosError: true, response: { status: 404 } })),
    )

    expect(await service.getByElectedOfficeId(OFFICE)).toBeNull()
  })

  it('throws BadGateway on an unexpected response shape', async () => {
    mockHttpGet.mockReturnValue(
      of({ data: { electedOfficeId: OFFICE }, status: 200 }),
    )

    await expect(service.getByElectedOfficeId(OFFICE)).rejects.toBeInstanceOf(
      BadGatewayException,
    )
  })

  it('throws BadGateway on a non-404 transport error', async () => {
    mockHttpGet.mockReturnValue(
      throwError(() => ({ isAxiosError: true, response: { status: 500 } })),
    )

    await expect(service.getByElectedOfficeId(OFFICE)).rejects.toBeInstanceOf(
      BadGatewayException,
    )
  })
})
