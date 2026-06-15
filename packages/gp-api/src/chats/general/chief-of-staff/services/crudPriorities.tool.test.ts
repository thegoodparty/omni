import { describe, expect, it, vi } from 'vitest'
import { buildCrudPrioritiesTool } from './crudPriorities.tool'
import { PrioritiesToolPort, PriorityRecord } from './prioritiesPort'

const priority = (id: string): PriorityRecord => ({
  id,
  title: `title-${id}`,
  description: `desc-${id}`,
  targetDate: null,
  archivedAt: null,
})

const buildPort = (
  overrides: Partial<PrioritiesToolPort> = {},
): PrioritiesToolPort => ({
  listActive: vi.fn(() => Promise.resolve([priority('a')])),
  create: vi.fn((input) =>
    Promise.resolve({ ...priority('new'), title: input.title }),
  ),
  update: vi.fn((input) =>
    Promise.resolve({ ...priority(input.id), title: input.title ?? 't' }),
  ),
  archive: vi.fn(() => Promise.resolve()),
  ...overrides,
})

const ELECTED_OFFICE_ID = 'office-1'

describe('buildCrudPrioritiesTool', () => {
  it('lists active priorities bound to the resolved office', async () => {
    const port = buildPort()
    const tool = buildCrudPrioritiesTool({
      port,
      electedOfficeId: ELECTED_OFFICE_ID,
    })
    const result = await tool.execute({ action: 'list' })
    expect(result).toEqual({ priorities: [priority('a')] })
    expect(port.listActive).toHaveBeenCalledWith(ELECTED_OFFICE_ID)
  })

  it('creates a priority with the server-bound office id', async () => {
    const port = buildPort()
    const tool = buildCrudPrioritiesTool({
      port,
      electedOfficeId: ELECTED_OFFICE_ID,
    })
    const result = await tool.execute({
      action: 'create',
      title: 'Affordable housing',
      description: 'Push three projects this term.',
    })
    expect(port.create).toHaveBeenCalledWith({
      electedOfficeId: ELECTED_OFFICE_ID,
      title: 'Affordable housing',
      description: 'Push three projects this term.',
    })
    expect(result).toHaveProperty('priority')
  })

  it('archives by id and returns archived: true', async () => {
    const port = buildPort()
    const tool = buildCrudPrioritiesTool({
      port,
      electedOfficeId: ELECTED_OFFICE_ID,
    })
    const result = await tool.execute({ action: 'archive', id: 'p-9' })
    expect(port.archive).toHaveBeenCalledWith(ELECTED_OFFICE_ID, 'p-9')
    expect(result).toEqual({ archived: true })
  })

  it('rejects input that the model cannot bind an office to', () => {
    const tool = buildCrudPrioritiesTool({
      port: buildPort(),
      electedOfficeId: ELECTED_OFFICE_ID,
    })
    // electedOfficeId is never part of the tool's input schema.
    expect(tool.inputSchema.safeParse({ action: 'list' }).success).toBe(true)
    expect(tool.inputSchema.safeParse({ action: 'archive' }).success).toBe(
      false,
    )
  })
})
