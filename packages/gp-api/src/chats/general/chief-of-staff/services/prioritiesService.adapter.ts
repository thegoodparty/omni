import { Injectable, NotFoundException } from '@nestjs/common'
import { formatISO } from 'date-fns'
import { PrioritySource } from '@/generated/prisma'
import { PrioritiesService } from '@/priorities/services/priorities.service'
import {
  CreatePriorityInput,
  PrioritiesToolPort,
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

// Binds slice 3's PrioritiesToolPort to slice 1's PrioritiesService. The port
// passes electedOfficeId in each call; the service uses positional args, so we
// map between them here.
@Injectable()
export class PrioritiesServiceAdapter implements PrioritiesToolPort {
  constructor(private readonly priorities: PrioritiesService) {}

  async listActive(electedOfficeId: string): Promise<PriorityRecord[]> {
    const rows = await this.priorities.listActive(electedOfficeId)
    return rows.map(toRecord)
  }

  async create(input: CreatePriorityInput): Promise<PriorityRecord> {
    const row = await this.priorities.create(
      input.electedOfficeId,
      { title: input.title, description: input.description },
      PrioritySource.user_stated,
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
    const archived = await this.priorities.archive(id, electedOfficeId)
    if (!archived) throw new NotFoundException('Priority not found')
  }
}
