import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotFoundException } from '@nestjs/common'
import { CampaignTaskType } from '../campaignTasks.types'
import { CampaignTasksService } from './campaignTasks.service'
import {
  Campaign,
  CampaignUpdateHistoryType,
  Prisma,
} from '../../../generated/prisma'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'

import { SlackService } from 'src/vendors/slack/services/slack.service'
import * as sleepUtil from 'src/shared/util/sleep.util'

const mockTxModel = {
  deleteMany: vi.fn(),
  createMany: vi.fn(),
  count: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
}

const mockModel = {
  findMany: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  count: vi.fn(),
}

const mockCampaignUpdateHistoryModel = {
  create: vi.fn(),
  delete: vi.fn(),
  findUniqueOrThrow: vi.fn(),
}

const mockCampaignModel = {
  findUnique: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  update: vi.fn(),
}

const mockCampaignTrackerTaskModel = {
  count: vi.fn().mockResolvedValue(0),
}

const mockExecuteRaw = vi.fn()
const mockTransaction = vi.fn(
  async (callback: (tx: unknown) => Promise<unknown>) => {
    return callback({
      campaignTask: mockTxModel,
      campaignUpdateHistory: mockCampaignUpdateHistoryModel,
      campaign: mockCampaignModel,
      $executeRaw: mockExecuteRaw,
    })
  },
)

const mockSlackService: Partial<SlackService> = {
  message: vi.fn(),
}

const mockCampaignsService = {
  patchCampaignDetails: vi.fn(),
}

const mockTrackerTasks = {
  notifyProUpgrade: vi.fn(),
}

type CampaignOverrides = Partial<Omit<Campaign, 'details' | 'data'>> & {
  details?: Campaign['details'] | null
  data?: Campaign['data'] | null
}

const makeCampaign = (overrides: CampaignOverrides = {}): Campaign =>
  ({
    id: 1,
    slug: 'test-campaign',
    userId: 123,
    isActive: true,
    isDemo: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    data: {},
    details: {},
    vendorTsData: {},
    ...overrides,
  }) as Campaign

const makeDbTask = (overrides = {}) => ({
  id: 'task-1',
  campaignId: 1,
  title: 'Test Task',
  description: 'A test task',
  cta: 'Do it',
  flowType: CampaignTaskType.education,
  week: 4,
  date: new Date('2026-06-01'),
  link: null,
  proRequired: false,
  isDefaultTask: false,
  deadline: null,
  defaultAiTemplateId: null,
  completed: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
})

describe('CampaignTasksService', () => {
  let service: CampaignTasksService

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(sleepUtil, 'sleep').mockResolvedValue(undefined)
    service = new CampaignTasksService(
      mockSlackService as SlackService,
      mockCampaignsService as never,
      mockTrackerTasks as never,
    )
    Object.defineProperty(service, '_prisma', {
      get: () => ({
        campaignTask: mockModel,
        campaign: mockCampaignModel,
        campaignTrackerTask: mockCampaignTrackerTaskModel,
        campaignUpdateHistory: mockCampaignUpdateHistoryModel,
        $transaction: mockTransaction,
      }),
      configurable: true,
    })
    Object.defineProperty(service, 'logger', {
      get: () => createMockLogger(),
      configurable: true,
    })
  })

  describe('listCampaignTasks', () => {
    it('Returns tasks ordered by week desc then date asc', async () => {
      const tasks = [makeDbTask({ week: 8 }), makeDbTask({ week: 4 })]
      mockModel.findMany.mockResolvedValue(tasks)

      const result = await service.listCampaignTasks(makeCampaign())

      expect(mockModel.findMany).toHaveBeenCalledWith({
        where: { campaignId: 1 },
        orderBy: [
          { week: Prisma.SortOrder.desc },
          { date: Prisma.SortOrder.asc },
          { id: Prisma.SortOrder.asc },
        ],
      })
      expect(result).toEqual(tasks)
    })
  })

  describe('getCampaignTaskById', () => {
    it('returns task matching campaignId and id', async () => {
      const task = makeDbTask()
      mockModel.findFirst.mockResolvedValue(task)

      const result = await service.getCampaignTaskById(1, 'task-1')

      expect(mockModel.findFirst).toHaveBeenCalledWith({
        where: { campaignId: 1, id: 'task-1' },
      })
      expect(result).toEqual(task)
    })

    it('returns null when task not found', async () => {
      mockModel.findFirst.mockResolvedValue(null)

      const result = await service.getCampaignTaskById(1, 'nonexistent')

      expect(result).toBeNull()
    })
  })

  describe('completeTask', () => {
    it('marks task as completed without voter contact', async () => {
      const task = makeDbTask()
      const updatedTask = { ...task, completed: true }
      mockTxModel.findFirst = vi.fn().mockResolvedValue(task)
      mockTxModel.update = vi.fn().mockResolvedValue(updatedTask)

      const result = await service.completeTask(makeCampaign(), 'task-1')

      expect(mockExecuteRaw).not.toHaveBeenCalled()
      expect(mockTxModel.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { completed: true },
      })
      expect(result).toEqual(updatedTask)
    })

    it('throws NotFoundException when task not found', async () => {
      mockTxModel.findFirst = vi.fn().mockResolvedValue(null)

      await expect(
        service.completeTask(makeCampaign(), 'missing'),
      ).rejects.toThrow(NotFoundException)
    })

    it('returns task as-is when already completed', async () => {
      const task = makeDbTask({ completed: true })
      mockTxModel.findFirst = vi.fn().mockResolvedValue(task)
      mockTxModel.update = vi.fn()

      const result = await service.completeTask(makeCampaign(), 'task-1')

      expect(result).toEqual(task)
      expect(mockTxModel.update).not.toHaveBeenCalled()
    })

    it('creates update history and increments voter goals when voterContact provided', async () => {
      const task = makeDbTask({
        flowType: CampaignUpdateHistoryType.doorKnocking,
      })
      const updatedTask = {
        ...task,
        completed: true,
        updateHistoryId: 42,
      }
      mockTxModel.findFirst = vi.fn().mockResolvedValue(task)
      mockTxModel.update = vi.fn().mockResolvedValue(updatedTask)
      mockCampaignUpdateHistoryModel.create.mockResolvedValue({
        id: 42,
      })
      mockCampaignModel.findUniqueOrThrow.mockResolvedValue({
        id: 1,
        data: {
          reportedVoterGoals: {
            [CampaignUpdateHistoryType.doorKnocking]: 5,
          },
        },
      })
      mockCampaignModel.update.mockResolvedValue({})

      const result = await service.completeTask(makeCampaign(), 'task-1', {
        type: CampaignUpdateHistoryType.doorKnocking,
        quantity: 10,
      })

      expect(mockExecuteRaw).toHaveBeenCalled()
      expect(mockCampaignUpdateHistoryModel.create).toHaveBeenCalledWith({
        data: {
          type: CampaignUpdateHistoryType.doorKnocking,
          quantity: 10,
          campaignId: 1,
          userId: 123,
        },
      })
      expect(mockCampaignModel.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          data: {
            reportedVoterGoals: {
              [CampaignUpdateHistoryType.doorKnocking]: 15,
            },
          },
        },
      })
      expect(mockTxModel.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { completed: true, updateHistoryId: 42 },
      })
      expect(result).toEqual(updatedTask)
    })

    it('initializes reportedVoterGoals when none exist yet', async () => {
      const task = makeDbTask({
        flowType: CampaignUpdateHistoryType.text,
      })
      const updatedTask = {
        ...task,
        completed: true,
        updateHistoryId: 99,
      }
      mockTxModel.findFirst = vi.fn().mockResolvedValue(task)
      mockTxModel.update = vi.fn().mockResolvedValue(updatedTask)
      mockCampaignUpdateHistoryModel.create.mockResolvedValue({
        id: 99,
      })
      mockCampaignModel.findUniqueOrThrow.mockResolvedValue({
        id: 1,
        data: {},
      })
      mockCampaignModel.update.mockResolvedValue({})

      const result = await service.completeTask(makeCampaign(), 'task-1', {
        type: CampaignUpdateHistoryType.text,
        quantity: 5,
      })

      expect(mockCampaignModel.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          data: {
            reportedVoterGoals: {
              [CampaignUpdateHistoryType.text]: 5,
            },
          },
        },
      })
      expect(result).toEqual(updatedTask)
    })

    it('adds new type key when reportedVoterGoals exists but lacks the type', async () => {
      const task = makeDbTask({
        flowType: CampaignUpdateHistoryType.phoneBanking,
      })
      const updatedTask = {
        ...task,
        completed: true,
        updateHistoryId: 77,
      }
      mockTxModel.findFirst = vi.fn().mockResolvedValue(task)
      mockTxModel.update = vi.fn().mockResolvedValue(updatedTask)
      mockCampaignUpdateHistoryModel.create.mockResolvedValue({
        id: 77,
      })
      mockCampaignModel.findUniqueOrThrow.mockResolvedValue({
        id: 1,
        data: {
          reportedVoterGoals: {
            [CampaignUpdateHistoryType.doorKnocking]: 10,
          },
        },
      })
      mockCampaignModel.update.mockResolvedValue({})

      const result = await service.completeTask(makeCampaign(), 'task-1', {
        type: CampaignUpdateHistoryType.phoneBanking,
        quantity: 3,
      })

      expect(mockCampaignModel.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          data: {
            reportedVoterGoals: {
              [CampaignUpdateHistoryType.doorKnocking]: 10,
              [CampaignUpdateHistoryType.phoneBanking]: 3,
            },
          },
        },
      })
      expect(result).toEqual(updatedTask)
    })
  })

  describe('unCompleteTask', () => {
    it('marks task as uncompleted without history', async () => {
      const task = makeDbTask({
        completed: true,
        updateHistoryId: null,
      })
      const updatedTask = { ...task, completed: false }
      mockTxModel.findFirst = vi.fn().mockResolvedValue(task)
      mockTxModel.update = vi.fn().mockResolvedValue(updatedTask)

      const result = await service.unCompleteTask(makeCampaign(), 'task-1')

      expect(mockExecuteRaw).not.toHaveBeenCalled()
      expect(mockTxModel.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { completed: false, updateHistoryId: null },
      })
      expect(result).toEqual(updatedTask)
    })

    it('throws NotFoundException when task not found', async () => {
      mockTxModel.findFirst = vi.fn().mockResolvedValue(null)

      await expect(
        service.unCompleteTask(makeCampaign(), 'missing'),
      ).rejects.toThrow(NotFoundException)
    })

    it('returns task as-is when already uncompleted', async () => {
      const task = makeDbTask({ completed: false })
      mockTxModel.findFirst = vi.fn().mockResolvedValue(task)
      mockTxModel.update = vi.fn()

      const result = await service.unCompleteTask(makeCampaign(), 'task-1')

      expect(result).toEqual(task)
      expect(mockTxModel.update).not.toHaveBeenCalled()
    })

    it('deletes history and decrements voter goals when history exists', async () => {
      const task = makeDbTask({
        completed: true,
        updateHistoryId: 42,
      })
      const updatedTask = {
        ...task,
        completed: false,
        updateHistoryId: null,
      }
      mockTxModel.findFirst = vi.fn().mockResolvedValue(task)
      mockCampaignUpdateHistoryModel.findUniqueOrThrow.mockResolvedValue({
        id: 42,
        type: CampaignUpdateHistoryType.doorKnocking,
        quantity: 10,
      })
      mockTxModel.update = vi.fn().mockResolvedValue(updatedTask)
      mockCampaignModel.findUniqueOrThrow.mockResolvedValue({
        id: 1,
        data: {
          reportedVoterGoals: {
            [CampaignUpdateHistoryType.doorKnocking]: 15,
          },
        },
      })
      mockCampaignModel.update.mockResolvedValue({})
      mockCampaignUpdateHistoryModel.delete.mockResolvedValue({})

      const result = await service.unCompleteTask(makeCampaign(), 'task-1')

      expect(mockExecuteRaw).toHaveBeenCalled()
      expect(mockCampaignModel.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          data: {
            reportedVoterGoals: {
              [CampaignUpdateHistoryType.doorKnocking]: 5,
            },
          },
        },
      })
      expect(mockCampaignUpdateHistoryModel.delete).toHaveBeenCalledWith({
        where: { id: 42 },
      })
      expect(mockTxModel.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: { completed: false, updateHistoryId: null },
      })
      expect(result).toEqual(updatedTask)
    })

    it('floors voter goals at 0 when decrementing', async () => {
      const task = makeDbTask({
        completed: true,
        updateHistoryId: 42,
      })
      mockTxModel.findFirst = vi.fn().mockResolvedValue(task)
      mockCampaignUpdateHistoryModel.findUniqueOrThrow.mockResolvedValue({
        id: 42,
        type: CampaignUpdateHistoryType.text,
        quantity: 100,
      })
      mockTxModel.update = vi.fn().mockResolvedValue({
        ...task,
        completed: false,
      })
      mockCampaignModel.findUniqueOrThrow.mockResolvedValue({
        id: 1,
        data: {
          reportedVoterGoals: {
            [CampaignUpdateHistoryType.text]: 5,
          },
        },
      })
      mockCampaignModel.update.mockResolvedValue({})
      mockCampaignUpdateHistoryModel.delete.mockResolvedValue({})

      await service.unCompleteTask(makeCampaign(), 'task-1')

      expect(mockCampaignModel.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          data: {
            reportedVoterGoals: {
              [CampaignUpdateHistoryType.text]: 0,
            },
          },
        },
      })
    })
  })

  describe('notifySlackOnProUpgrade', () => {
    const candidateMock = {
      id: 1,
      data: { name: 'Test Candidate', hubspotId: '12345' },
      user: { firstName: 'Jane', lastName: 'Doe' },
      campaignTasks: [
        {
          flowType: CampaignTaskType.text,
          title: 'Introduction Text',
          date: new Date('2025-06-15'),
        },
      ],
    }

    it('routes tracker-cohort campaigns to the tracker current-week message', async () => {
      mockCampaignModel.findUnique = vi.fn().mockResolvedValue({ details: {} })
      mockCampaignTrackerTaskModel.count.mockResolvedValueOnce(5)
      mockTrackerTasks.notifyProUpgrade.mockResolvedValueOnce(true)
      mockCampaignsService.patchCampaignDetails.mockResolvedValue({})

      await service.notifySlackOnProUpgrade(1)

      expect(mockTrackerTasks.notifyProUpgrade).toHaveBeenCalledWith(1)
      // the legacy plan message is skipped for tracker campaigns
      expect(mockModel.count).not.toHaveBeenCalled()
      expect(mockSlackService.message).not.toHaveBeenCalled()
      expect(mockCampaignsService.patchCampaignDetails).toHaveBeenCalledWith(
        1,
        {
          proUpgradeSlackNotifiedAt: expect.any(Number),
        },
      )
    })

    it('skips the notified stamp when the tracker notification is a no-op', async () => {
      mockCampaignModel.findUnique = vi.fn().mockResolvedValue({ details: {} })
      mockCampaignTrackerTaskModel.count.mockResolvedValueOnce(5)
      // e.g. the campaign upgraded before its first dynamic generation landed
      mockTrackerTasks.notifyProUpgrade.mockResolvedValueOnce(false)

      await service.notifySlackOnProUpgrade(1)

      expect(mockTrackerTasks.notifyProUpgrade).toHaveBeenCalledWith(1)
      // Not stamped, so a later trigger (the first generation) can still notify.
      expect(mockCampaignsService.patchCampaignDetails).not.toHaveBeenCalled()
    })

    it('sends slack and persists the notified-at flag when default tasks exist', async () => {
      mockCampaignModel.findUnique = vi.fn().mockResolvedValue({ details: {} })
      mockModel.count.mockResolvedValueOnce(1)
      mockCampaignModel.findUniqueOrThrow.mockResolvedValue(candidateMock)
      mockCampaignsService.patchCampaignDetails.mockResolvedValue({})
      vi.mocked(mockSlackService.message!).mockResolvedValue('ok')

      await service.notifySlackOnProUpgrade(1)

      expect(mockSlackService.message).toHaveBeenCalledTimes(1)
      expect(mockCampaignsService.patchCampaignDetails).toHaveBeenCalledWith(
        1,
        { proUpgradeSlackNotifiedAt: expect.any(Number) },
      )
    })

    it('does nothing if proUpgradeSlackNotifiedAt is already set', async () => {
      mockCampaignModel.findUnique = vi
        .fn()
        .mockResolvedValue({ details: { proUpgradeSlackNotifiedAt: 1 } })

      await service.notifySlackOnProUpgrade(1)

      expect(mockModel.count).not.toHaveBeenCalled()
      expect(mockSlackService.message).not.toHaveBeenCalled()
      expect(mockCampaignsService.patchCampaignDetails).not.toHaveBeenCalled()
    })

    it('does not send Slack if no default tasks exist', async () => {
      mockCampaignModel.findUnique = vi.fn().mockResolvedValue({ details: {} })
      mockModel.count.mockResolvedValueOnce(0)

      await service.notifySlackOnProUpgrade(1)

      expect(mockSlackService.message).not.toHaveBeenCalled()
      expect(mockCampaignsService.patchCampaignDetails).not.toHaveBeenCalled()
    })

    it('does nothing when the campaign has no details', async () => {
      mockCampaignModel.findUnique = vi.fn().mockResolvedValue(null)

      await service.notifySlackOnProUpgrade(1)

      expect(mockModel.count).not.toHaveBeenCalled()
      expect(mockSlackService.message).not.toHaveBeenCalled()
    })

    it('retries the slack send up to 3 times then succeeds', async () => {
      mockCampaignModel.findUnique = vi.fn().mockResolvedValue({ details: {} })
      mockModel.count.mockResolvedValueOnce(1)
      mockCampaignModel.findUniqueOrThrow.mockResolvedValue(candidateMock)
      mockCampaignsService.patchCampaignDetails.mockResolvedValue({})

      const messageMock = vi.mocked(mockSlackService.message!)
      messageMock.mockReset()
      messageMock
        .mockRejectedValueOnce(new Error('boom1'))
        .mockRejectedValueOnce(new Error('boom2'))
        .mockResolvedValueOnce('ok')

      await service.notifySlackOnProUpgrade(1)

      expect(messageMock).toHaveBeenCalledTimes(3)
      expect(mockCampaignsService.patchCampaignDetails).toHaveBeenCalled()
    })

    it('retries when slack returns no data (swallowed failure)', async () => {
      mockCampaignModel.findUnique = vi.fn().mockResolvedValue({ details: {} })
      mockModel.count.mockResolvedValueOnce(1)
      mockCampaignModel.findUniqueOrThrow.mockResolvedValue(candidateMock)
      mockCampaignsService.patchCampaignDetails.mockClear()

      const messageMock = vi.mocked(mockSlackService.message!)
      messageMock.mockReset()
      messageMock.mockResolvedValue(undefined)

      await expect(service.notifySlackOnProUpgrade(1)).resolves.not.toThrow()
      expect(messageMock).toHaveBeenCalledTimes(3)
      expect(mockCampaignsService.patchCampaignDetails).not.toHaveBeenCalled()
    })

    it('swallows errors when slack fails on all 3 attempts', async () => {
      mockCampaignModel.findUnique = vi.fn().mockResolvedValue({ details: {} })
      mockModel.count.mockResolvedValueOnce(1)
      mockCampaignModel.findUniqueOrThrow.mockResolvedValue(candidateMock)
      mockCampaignsService.patchCampaignDetails.mockClear()

      const messageMock = vi.mocked(mockSlackService.message!)
      messageMock.mockReset()
      messageMock.mockRejectedValue(new Error('boom'))

      await expect(service.notifySlackOnProUpgrade(1)).resolves.not.toThrow()
      expect(messageMock).toHaveBeenCalledTimes(3)
      expect(mockCampaignsService.patchCampaignDetails).not.toHaveBeenCalled()
    })
  })
})
