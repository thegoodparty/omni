import { BadRequestException } from '@nestjs/common'
import {
  PRIORITY_GATE_STEPS,
  type PriorityCheckSide,
  type PriorityStepId,
  type ProposalLink,
} from '@goodparty_org/contracts'
import type { PrismaClient } from '../../generated/prisma'
import { assertPriorityInOffice } from './assertPriorityInOffice.util'

// The Outreach columns a chat card's link writes.
export type ProposalOutreachLink = {
  proposalKey?: string
  priorityId?: string
  priorityStepId?: PriorityStepId
  priorityCheckSide?: PriorityCheckSide
}

// A send moves the check it names to out, so the check has to be one this
// office's priority carries: a gate step, both halves given, on a priority
// in the caller's own office.
export const resolveProposalLink = async (
  client: Pick<PrismaClient, 'priority'>,
  { proposalKey, priorityId, stepId, side }: ProposalLink,
  electedOfficeId: string,
): Promise<ProposalOutreachLink> => {
  if ((stepId === undefined) !== (side === undefined)) {
    throw new BadRequestException('stepId and side are sent together')
  }
  if (stepId !== undefined && priorityId === undefined) {
    throw new BadRequestException('stepId needs the priority it belongs to')
  }
  if (stepId !== undefined && !PRIORITY_GATE_STEPS.includes(stepId)) {
    throw new BadRequestException(`${stepId} does not carry a check`)
  }
  if (priorityId !== undefined) {
    await assertPriorityInOffice(client, priorityId, electedOfficeId)
  }
  return {
    ...(proposalKey !== undefined && { proposalKey }),
    ...(priorityId !== undefined && { priorityId }),
    ...(stepId !== undefined && { priorityStepId: stepId }),
    ...(side !== undefined && { priorityCheckSide: side }),
  }
}
