import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import type { Organization } from '../../../generated/prisma'
import { PRO_FILTERING_REQUIRED_MESSAGE } from '@/contacts/services/contacts.service'
import { FILTER_PRO_REQUIRED_MESSAGE } from '@/voters/services/voterFileFilter.service'
import { buildCrudSavedFiltersTool } from './crudSavedFilters.tool'

const ORGANIZATION = { slug: 'win-campaign' } as Organization

type ToolDeps = Parameters<typeof buildCrudSavedFiltersTool>[0]

const buildDeps = (over: {
  voterFileFilters?: Partial<ToolDeps['voterFileFilters']>
  countContacts?: ToolDeps['contacts']['countContacts']
}): ToolDeps => ({
  voterFileFilters: {
    create: vi.fn(),
    updateByIdAndOrganizationSlug: vi.fn(),
    deleteByIdAndOrganizationSlug: vi.fn(),
    findByOrganizationSlug: vi.fn(() => Promise.resolve([])),
    findByIdAndOrganizationSlug: vi.fn(() => Promise.resolve(null)),
    filterAccessCheck: vi.fn(() => Promise.resolve()),
    ...over.voterFileFilters,
  } as ToolDeps['voterFileFilters'],
  contacts: { countContacts: over.countContacts ?? vi.fn() },
  organization: ORGANIZATION,
})

const buildTool = (over: Parameters<typeof buildDeps>[0] = {}) => {
  const deps = buildDeps(over)
  return { deps, tool: buildCrudSavedFiltersTool(deps) }
}

describe('crud_saved_filters input schema', () => {
  const { tool } = buildTool()

  it('rejects a per-channel action invalid for its channel', () => {
    expect(
      tool.inputSchema.safeParse({
        action: 'create',
        name: 'Bad action',
        activityConditions: [
          // voicemail_left is a robocall outcome; invalid on the text channel
          { outreachType: 'text', actions: ['voicemail_left'] },
        ],
      }).success,
    ).toBe(false)
  })

  it('rejects names over the 40-character cap', () => {
    expect(
      tool.inputSchema.safeParse({
        action: 'create',
        name: 'x'.repeat(41),
      }).success,
    ).toBe(false)
    expect(
      tool.inputSchema.safeParse({
        action: 'create',
        name: 'x'.repeat(40),
      }).success,
    ).toBe(true)
  })

  it('rejects unknown actions and non-integer ids', () => {
    expect(tool.inputSchema.safeParse({ action: 'read' }).success).toBe(false)
    expect(
      tool.inputSchema.safeParse({ action: 'delete', id: 1.5 }).success,
    ).toBe(false)
  })
})

describe('crud_saved_filters execute', () => {
  it('list returns only { id, name } pairs', async () => {
    const { tool } = buildTool({
      voterFileFilters: {
        findByOrganizationSlug: vi.fn(() =>
          Promise.resolve([
            { id: 1, name: 'Supporters', partyDemocrat: true },
            { id: 2, name: null, genderFemale: true },
          ]),
        ) as never,
      },
    })
    const result = await tool.execute({ action: 'list' })
    expect(result).toEqual({
      filters: [
        { id: 1, name: 'Supporters' },
        { id: 2, name: null },
      ],
    })
  })

  it('create requires a name', async () => {
    const { deps, tool } = buildTool()
    const result = await tool.execute({ action: 'create' })
    expect(result).toEqual({ error: 'create requires name' })
    expect(deps.voterFileFilters.create).not.toHaveBeenCalled()
  })

  it('update and delete require an id', async () => {
    const { deps, tool } = buildTool()
    expect(await tool.execute({ action: 'update', name: 'New' })).toEqual({
      error: 'update requires id',
    })
    expect(await tool.execute({ action: 'delete' })).toEqual({
      error: 'delete requires id',
    })
    expect(
      deps.voterFileFilters.updateByIdAndOrganizationSlug,
    ).not.toHaveBeenCalled()
    expect(
      deps.voterFileFilters.deleteByIdAndOrganizationSlug,
    ).not.toHaveBeenCalled()
  })

  it('create counts first, then persists, and returns { id, name, count }', async () => {
    const countContacts = vi.fn(() => Promise.resolve(321))
    const create = vi.fn(() =>
      Promise.resolve({ id: 9, name: 'Persisted name' }),
    )
    const { tool } = buildTool({
      countContacts,
      voterFileFilters: { create: create as never },
    })
    const input = tool.inputSchema.parse({
      action: 'create',
      name: 'Young supporters',
      age18_25: true,
      supportStatus: ['supporter'],
    })
    const result = await tool.execute(input)
    // The response reads from the persisted record, not the request input.
    expect(result).toEqual({ id: 9, name: 'Persisted name', count: 321 })
    expect(countContacts).toHaveBeenCalledWith(
      { age18_25: true, supportStatus: ['supporter'] },
      ORGANIZATION,
    )
    expect(create).toHaveBeenCalledWith(ORGANIZATION.slug, {
      age18_25: true,
      supportStatus: ['supporter'],
      name: 'Young supporters',
      voterCount: 0,
    })
    expect(countContacts.mock.invocationCallOrder[0]).toBeLessThan(
      create.mock.invocationCallOrder[0] ?? 0,
    )
  })

  it("surfaces the route's non-Pro create rejection without persisting", async () => {
    const create = vi.fn()
    const { tool } = buildTool({
      voterFileFilters: {
        filterAccessCheck: vi.fn(() =>
          Promise.reject(new BadRequestException(FILTER_PRO_REQUIRED_MESSAGE)),
        ),
        create,
      },
    })
    const result = await tool.execute(
      tool.inputSchema.parse({ action: 'create', name: 'Blocked' }),
    )
    expect(result).toEqual({
      error: expect.stringContaining('upgrading to Pro'),
    })
    expect(create).not.toHaveBeenCalled()
  })

  it("surfaces the count path's non-Pro rejection without persisting", async () => {
    const create = vi.fn()
    const { tool } = buildTool({
      countContacts: vi.fn(() =>
        Promise.reject(new BadRequestException(PRO_FILTERING_REQUIRED_MESSAGE)),
      ),
      voterFileFilters: { create },
    })
    const result = await tool.execute(
      tool.inputSchema.parse({ action: 'create', name: 'Blocked' }),
    )
    expect(result).toEqual({
      error: expect.stringContaining('upgrading to Pro'),
    })
    expect(create).not.toHaveBeenCalled()
  })

  it('maps the locked-filter conflict to the duplicate-to-edit error', async () => {
    const { tool } = buildTool({
      voterFileFilters: {
        findByIdAndOrganizationSlug: vi.fn(() =>
          Promise.resolve({ id: 4, name: 'Locked' }),
        ) as never,
        updateByIdAndOrganizationSlug: vi.fn(() =>
          Promise.reject(
            new ConflictException(
              'This list has already been used for outreach and is locked ' +
                'from edits — duplicate it to make changes.',
            ),
          ),
        ),
      },
    })
    const result = await tool.execute(
      tool.inputSchema.parse({ action: 'update', id: 4, name: 'Renamed' }),
    )
    expect(result).toEqual({ error: expect.stringContaining('duplicated') })
    expect(result).toEqual({
      error: expect.stringContaining('instead of retrying'),
    })
  })

  it('returns not-found for a filter id outside this organization', async () => {
    const { deps, tool } = buildTool()
    const updateResult = await tool.execute(
      tool.inputSchema.parse({ action: 'update', id: 999, name: 'Nope' }),
    )
    expect(updateResult).toEqual({
      error: expect.stringContaining('No saved list with id 999'),
    })
    const deleteResult = await tool.execute(
      tool.inputSchema.parse({ action: 'delete', id: 999 }),
    )
    expect(deleteResult).toEqual({
      error: expect.stringContaining('No saved list with id 999'),
    })
    expect(
      deps.voterFileFilters.updateByIdAndOrganizationSlug,
    ).not.toHaveBeenCalled()
    expect(
      deps.voterFileFilters.deleteByIdAndOrganizationSlug,
    ).not.toHaveBeenCalled()
  })

  it('lets non-business failures (people-api outage) propagate', async () => {
    const outage = new BadGatewayException('Failed to count from people API')
    const { tool } = buildTool({
      countContacts: vi.fn(() => Promise.reject(outage)),
    })
    await expect(
      tool.execute(tool.inputSchema.parse({ action: 'create', name: 'X' })),
    ).rejects.toBe(outage)
  })
})
