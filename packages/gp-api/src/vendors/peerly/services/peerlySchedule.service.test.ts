import { BadGatewayException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { createMockLogger } from 'src/shared/test-utils/mockLogger.util'
import { PinoLogger } from 'nestjs-pino'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { firstOrThrow } from 'src/shared/test-utils/arrays.util'
import { P2P_SCHEDULE_DEFAULTS } from '../constants/p2pJob.constants'
import { PeerlyScheduleService } from './peerlySchedule.service'
import { PeerlyErrorHandlingService } from './peerlyErrorHandling.service'
import { PeerlyHttpService } from './peerlyHttp.service'

describe('PeerlyScheduleService', () => {
  let service: PeerlyScheduleService
  let mockHttpService: {
    post: ReturnType<typeof vi.fn>
    validateResponse: ReturnType<typeof vi.fn>
  }
  let mockErrorHandling: {
    handleApiError: ReturnType<typeof vi.fn>
  }

  const mockScheduleResponse = {
    Data: {
      schedule_id: 12345,
      schedule_name: 'GP P2P - Campaign 1 - 2026-04-15 - Test',
      account: '88889754',
    },
  }

  beforeEach(async () => {
    mockHttpService = {
      post: vi.fn().mockResolvedValue({ data: mockScheduleResponse }),
      validateResponse: vi.fn().mockImplementation((_data) => _data),
    }
    mockErrorHandling = {
      handleApiError: vi.fn().mockImplementation(() => {
        throw new BadGatewayException('mock error')
      }),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PeerlyScheduleService,
        { provide: PinoLogger, useValue: createMockLogger() },
        { provide: PeerlyHttpService, useValue: mockHttpService },
        {
          provide: PeerlyErrorHandlingService,
          useValue: mockErrorHandling,
        },
      ],
    }).compile()

    service = module.get(PeerlyScheduleService)
    Object.defineProperty(service, 'logger', {
      get: () => createMockLogger(),
      configurable: true,
    })
  })

  describe('createSchedule', () => {
    it('returns schedule_id from validated response', async () => {
      const result = await service.createSchedule('Test Schedule', '09:00')

      expect(result).toBe(12345)
    })

    it('posts to /schedule with correct body structure', async () => {
      await service.createSchedule('My Schedule', '09:00')

      expect(mockHttpService.post).toHaveBeenCalledWith(
        '/schedule',
        expect.objectContaining({
          schedule_name: 'My Schedule',
          schedule_timezone: P2P_SCHEDULE_DEFAULTS.TIMEZONE,
          is_global: P2P_SCHEDULE_DEFAULTS.IS_GLOBAL,
          mon_start: '09:00:00',
          mon_end: '21:00:00',
          tue_start: '09:00:00',
          tue_end: '21:00:00',
          wed_start: '09:00:00',
          wed_end: '21:00:00',
          thu_start: '09:00:00',
          thu_end: '21:00:00',
          fri_start: '09:00:00',
          fri_end: '21:00:00',
          sat_start: '09:00:00',
          sat_end: '21:00:00',
          sun_start: '09:00:00',
          sun_end: '21:00:00',
        }),
      )
    })

    it('opens every day at the given start and closes at the 9pm cutoff', async () => {
      await service.createSchedule('Evening', '18:00')

      const [, body] = firstOrThrow(mockHttpService.post.mock.calls) as [
        string,
        Record<string, string>,
      ]
      for (const day of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
        expect(body[`${day}_start`]).toBe('18:00:00')
        expect(body[`${day}_end`]).toBe('21:00:00')
      }
    })

    it('includes account number in request body', async () => {
      await service.createSchedule('Test', '09:00')

      const postCall = firstOrThrow(mockHttpService.post.mock.calls)
      expect(postCall[1].account).toBe(service.accountNumber)
    })

    it('throws BadGatewayException on API failure', async () => {
      mockHttpService.post.mockRejectedValue(new Error('API down'))

      await expect(service.createSchedule('Fail', '09:00')).rejects.toThrow(
        BadGatewayException,
      )
    })
  })
})
