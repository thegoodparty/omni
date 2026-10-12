import {
  PRIORITY_STEP_IDS,
  Priority as PriorityDto,
} from '@goodparty_org/contracts'
import { Priority } from '../../generated/prisma'

// `currentStep: null` means every step is settled, but a priority the agent
// has never written a status for has a null currentStep too. Without this, a
// brand-new priority reads as "Plan ready" on the list and "all steps done" to
// the Chief of Staff.
export const currentStepOf = (
  record: Pick<Priority, 'status' | 'currentStep'>,
): string | null =>
  record.status === null ? PRIORITY_STEP_IDS[0] : record.currentStep

export const priorityToApi = (record: Priority): PriorityDto => ({
  id: record.id,
  electedOfficeId: record.electedOfficeId,
  title: record.title,
  description: record.description,
  source: record.source,
  sourceCampaignPositionId: record.sourceCampaignPositionId,
  currentStep: currentStepOf(record),
  nextAction: record.nextAction,
  createdAt: record.createdAt.toISOString(),
  updatedAt: record.updatedAt.toISOString(),
})
