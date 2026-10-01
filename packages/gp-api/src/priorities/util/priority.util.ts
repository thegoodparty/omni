import { Priority as PriorityDto } from '@goodparty_org/contracts'
import { Priority } from '../../generated/prisma'

export const priorityToApi = (record: Priority): PriorityDto => ({
  id: record.id,
  electedOfficeId: record.electedOfficeId,
  title: record.title,
  description: record.description,
  source: record.source,
  sourceCampaignPositionId: record.sourceCampaignPositionId,
  currentStep: record.currentStep,
  nextAction: record.nextAction,
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
})
