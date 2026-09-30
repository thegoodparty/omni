import { NotFoundException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { PrioritiesService } from '@/priorities/services/priorities.service'
import { PrioritiesServiceAdapter } from './prioritiesService.adapter'

const row = (archivedAt: Date | null) => ({
  id: 'p1',
  title: 'Affordable housing',
  description: 'Three projects this term.',
  archivedAt,
})

const adapterWith = (stub: Record<string, unknown>) =>
  new PrioritiesServiceAdapter(stub as unknown as PrioritiesService)

describe('PrioritiesServiceAdapter', () => {
  it('maps a service row onto the tool record', async () => {
    const adapter = adapterWith({
      listActive: async () => [row(null)],
    })

    const records = await adapter.listActive('office-1')

    expect(records).toEqual([
      {
        id: 'p1',
        title: 'Affordable housing',
        description: 'Three projects this term.',
        archivedAt: null,
      },
    ])
  })

  // The service scopes every write to the office and answers a miss with null
  // or false, which the model would read as a successful edit.
  it('turns a miss on update into a 404', async () => {
    const adapter = adapterWith({ update: async () => null })

    await expect(
      adapter.update({
        electedOfficeId: 'office-1',
        id: 'p1',
        title: 'Renamed',
      }),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('turns a miss on archive into a 404', async () => {
    const adapter = adapterWith({ archive: async () => false })

    await expect(adapter.archive('office-1', 'p1')).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })
})
