import { Injectable, NotFoundException } from '@nestjs/common'
import { format, formatISO, parseISO } from 'date-fns'
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
  targetDate: Date | null
  archivedAt: Date | null
}

const toRecord = (row: PriorityRow): PriorityRecord => ({
  id: row.id,
  title: row.title,
  description: row.description,
  targetDate: row.targetDate ? format(row.targetDate, 'yyyy-MM-dd') : null,
  archivedAt: row.archivedAt ? formatISO(row.archivedAt) : null,
})

const toDate = (value?: string | null): Date | null =>
  value ? parseISO(value) : null

// Binds slice 3's PrioritiesToolPort to slice 1's PrioritiesService. The port
// passes electedOfficeId in each call and exchanges ISO date strings; the
// service uses positional args and Prisma Date values, so we map both here.
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
      {
        title: input.title,
        description: input.description,
        targetDate: toDate(input.targetDate),
      },
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
      ...(input.targetDate !== undefined
        ? { targetDate: toDate(input.targetDate) }
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
