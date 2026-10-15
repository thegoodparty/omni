import { Injectable, NotFoundException } from '@nestjs/common'
import { formatISO } from 'date-fns'
import {
  PriorityStepIdSchema,
  parsePriorityStatus,
} from '@goodparty_org/contracts'
import { Priority, PrioritySource } from '@/generated/prisma'
import { PrioritiesService } from '@/priorities/services/priorities.service'
import { currentStepOf } from '@/priorities/util/priority.util'
import {
  CreatePriorityInput,
  PrioritiesToolPort,
  PriorityFlowState,
  PriorityRecord,
  UpdatePriorityInput,
} from './prioritiesPort'

type PriorityRow = {
  id: string
  title: string
  description: string
  archivedAt: Date | null
}

const toRecord = (row: PriorityRow): PriorityRecord => ({
  id: row.id,
  title: row.title,
  description: row.description,
  archivedAt: row.archivedAt ? formatISO(row.archivedAt) : null,
})

type PriorityFlowRow = Pick<Priority, 'status' | 'currentStep' | 'nextAction'>

const toFlowState = (row: PriorityFlowRow): PriorityFlowState => {
  const status = parsePriorityStatus(row.status)
  const currentStep = PriorityStepIdSchema.safeParse(currentStepOf(row))
  return {
    currentStep: currentStep.success ? currentStep.data : null,
    nextAction: row.nextAction,
    checks: status.steps.flatMap((step) =>
      step.check === undefined ? [] : [{ stepId: step.id, check: step.check }],
    ),
  }
}

// Binds slice 3's PrioritiesToolPort to slice 1's PrioritiesService. The port
// passes electedOfficeId in each call; the service uses positional args, so we
// map between them here.
@Injectable()
export class PrioritiesServiceAdapter implements PrioritiesToolPort {
  constructor(private readonly priorities: PrioritiesService) {}

  async listActive(electedOfficeId: string): Promise<PriorityRecord[]> {
    const rows = await this.priorities.listActive(electedOfficeId)
    return rows.map((row) => ({ ...toRecord(row), flow: toFlowState(row) }))
  }

  async create(input: CreatePriorityInput): Promise<PriorityRecord> {
    const row = await this.priorities.create(
      input.electedOfficeId,
      { title: input.title, description: input.description },
      PrioritySource.user_stated,
      'chief_of_staff',
    )
    return toRecord(row)
  }

  async update(input: UpdatePriorityInput): Promise<PriorityRecord> {
    const row = await this.priorities.update(input.id, input.electedOfficeId, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
    })
    if (!row) throw new NotFoundException('Priority not found')
    return toRecord(row)
  }

  async archive(electedOfficeId: string, id: string): Promise<void> {
    const archived = await this.priorities.archive(
      id,
      electedOfficeId,
      'chief_of_staff',
    )
    if (!archived) throw new NotFoundException('Priority not found')
  }
}
