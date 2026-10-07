import { NotFoundException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { PrioritiesService } from '@/priorities/services/priorities.service'
import { PrioritiesServiceAdapter } from './prioritiesService.adapter'

const row = (archivedAt: Date | null) => ({
  id: 'p1',
  title: 'Affordable housing',
  description: 'Three projects this term.',
  archivedAt,
  status: null,
  currentStep: null,
  nextAction: null,
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
        flow: { currentStep: null, nextAction: null, checks: [] },
      },
    ])
  })

  it('carries where the priority stands in its flow, with its checks', async () => {
    const adapter = adapterWith({
      listActive: async () => [
        {
          ...row(null),
          currentStep: 'evidence',
          nextAction: 'Pull the rent numbers',
          status: {
            version: 2,
            steps: [
              {
                id: 'define',
                state: 'settled',
                summary: 'Rents',
                check: { state: 'deferred', when: 'after the hearing' },
              },
              { id: 'evidence', state: 'active', summary: '' },
            ],
          },
        },
      ],
    })

    const [record] = await adapter.listActive('office-1')

    expect(record?.flow).toEqual({
      currentStep: 'evidence',
      nextAction: 'Pull the rent numbers',
      checks: [
        {
          stepId: 'define',
          check: {
            state: 'deferred',
            who: '',
            question: '',
            when: 'after the hearing',
            raised: 0,
          },
        },
      ],
    })
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
