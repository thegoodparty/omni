import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrioritiesService } from '@/priorities/services/priorities.service'
import { PrioritiesServiceAdapter } from './prioritiesService.adapter'

// targetDate is `@db.Date`. CI runs UTC, where a local-zone read and a UTC
// read agree, so these pin a zone that actually exercises the shift.
const ORIGINAL_TZ = process.env.TZ

const row = (targetDate: Date | null) => ({
  id: 'p1',
  title: 'Affordable housing',
  description: 'Three projects this term.',
  targetDate,
  archivedAt: null,
})

const adapterWith = (stub: Record<string, unknown>) =>
  new PrioritiesServiceAdapter(stub as unknown as PrioritiesService)

describe('PrioritiesServiceAdapter targetDate round trip', () => {
  afterAll(() => {
    process.env.TZ = ORIGINAL_TZ
  })

  describe('west of UTC', () => {
    beforeAll(() => {
      process.env.TZ = 'America/Los_Angeles'
    })

    it('reads the stored calendar day, not the local one', async () => {
      const adapter = adapterWith({
        listActive: async () => [row(new Date('2025-03-15T00:00:00.000Z'))],
      })
      const records = await adapter.listActive('office-1')
      expect(records[0]?.targetDate).toBe('2025-03-15')
    })
  })

  describe('east of UTC', () => {
    beforeAll(() => {
      process.env.TZ = 'Australia/Sydney'
    })

    it('stores the given day, not the local midnight before it', async () => {
      const stored: (Date | null)[] = []
      const adapter = adapterWith({
        create: async (
          _officeId: string,
          data: { targetDate: Date | null },
        ) => {
          stored.push(data.targetDate)
          return row(data.targetDate)
        },
      })

      const record = await adapter.create({
        electedOfficeId: 'office-1',
        title: 'Affordable housing',
        description: 'Three projects this term.',
        targetDate: '2025-03-15',
      })

      expect(stored[0]?.toISOString().slice(0, 10)).toBe('2025-03-15')
      expect(record.targetDate).toBe('2025-03-15')
    })
  })
})
