import { describe, expect, it, vi } from 'vitest'
import {
  buildCrudPrioritiesTool,
  PriorityView,
  PrioritiesToolProvider,
} from './priorities.tool'

const PRIORITY: PriorityView = {
  id: 'p1',
  title: 'Housing',
  description: 'Build more homes',
  source: 'win_import',
  targetDate: null,
}

const makeProvider = (
  overrides: Partial<PrioritiesToolProvider> = {},
): PrioritiesToolProvider => ({
  list: vi.fn().mockResolvedValue([PRIORITY]),
  create: vi.fn().mockResolvedValue(PRIORITY),
  update: vi.fn().mockResolvedValue(PRIORITY),
  archive: vi.fn().mockResolvedValue(true),
  ...overrides,
})

describe('crud_priorities tool', () => {
  it('list maps to provider.list', async () => {
    const provider = makeProvider()
    const tool = buildCrudPrioritiesTool({ provider })

    const out = await tool.execute({ action: 'list' })

    expect(provider.list).toHaveBeenCalledOnce()
    expect(out).toEqual([PRIORITY])
  })

  it('create maps to provider.create', async () => {
    const provider = makeProvider()
    const tool = buildCrudPrioritiesTool({ provider })

    const out = await tool.execute({
      action: 'create',
      title: 'Transit',
      description: 'More buses',
      targetDate: '2026-12-31',
    })

    expect(provider.create).toHaveBeenCalledWith({
      title: 'Transit',
      description: 'More buses',
      targetDate: '2026-12-31',
    })
    expect(out).toEqual(PRIORITY)
  })

  it('update maps to provider.update', async () => {
    const provider = makeProvider()
    const tool = buildCrudPrioritiesTool({ provider })

    await tool.execute({ action: 'update', id: 'p1', title: 'Renamed' })

    expect(provider.update).toHaveBeenCalledWith('p1', {
      title: 'Renamed',
      description: undefined,
      targetDate: undefined,
    })
  })

  it('update returns a not-found marker when the row is missing', async () => {
    const provider = makeProvider({ update: vi.fn().mockResolvedValue(null) })
    const tool = buildCrudPrioritiesTool({ provider })

    const out = await tool.execute({ action: 'update', id: 'missing' })

    expect(out).toEqual({ error: 'Priority not found', id: 'missing' })
  })

  it('archive maps to provider.archive', async () => {
    const provider = makeProvider()
    const tool = buildCrudPrioritiesTool({ provider })

    const out = await tool.execute({ action: 'archive', id: 'p1' })

    expect(provider.archive).toHaveBeenCalledWith('p1')
    expect(out).toEqual({ archived: true, id: 'p1' })
  })
})
