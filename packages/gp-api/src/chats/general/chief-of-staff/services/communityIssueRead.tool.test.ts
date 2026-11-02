import { NotFoundException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'
import type {
  CommunityIssueDetail,
  CommunityIssueReadPort,
  CommunityIssueSummary,
} from './communityIssueRead.port'
import { buildReadCommunityIssuesTool } from './communityIssueRead.tool'

const ORG = 'eo-maple'
const OFFICE = 'office-1'

const summary: CommunityIssueSummary = {
  id: 'issue-1',
  list: 'top_community',
  title: 'Potholes on Main St',
  summary: 'Residents report potholes.',
  category: 'infrastructure',
  rank: 1,
  prioritized: false,
}

const detail: CommunityIssueDetail = {
  id: 'issue-1',
  title: 'Potholes on Main St',
  summary: 'Residents report potholes.',
  category: 'infrastructure',
  priority: 'high',
  rank: 1,
  detail: null,
  relatedBriefings: [],
  prioritized: false,
  priorityId: null,
}

const buildPort = (
  overrides: Partial<CommunityIssueReadPort> = {},
): CommunityIssueReadPort => ({
  list: vi.fn(() => Promise.resolve([summary])),
  getDetail: vi.fn(() => Promise.resolve(detail)),
  ...overrides,
})

const build = (port: CommunityIssueReadPort) =>
  buildReadCommunityIssuesTool({
    port,
    organizationSlug: ORG,
    electedOfficeId: OFFICE,
  })

describe('buildReadCommunityIssuesTool', () => {
  it("lists the office's community issues when called without an id", async () => {
    const port = buildPort()
    const result = await build(port).execute({})
    expect(result).toEqual({ issues: [summary] })
    expect(port.list).toHaveBeenCalledWith(ORG, OFFICE)
    expect(port.getDetail).not.toHaveBeenCalled()
  })

  it('returns an empty list for an office with no issues', async () => {
    const port = buildPort({ list: vi.fn(() => Promise.resolve([])) })
    expect(await build(port).execute({})).toEqual({ issues: [] })
  })

  it('fetches one issue in full by id', async () => {
    const port = buildPort()
    const result = await build(port).execute({ id: 'issue-1' })
    expect(result).toEqual(detail)
    expect(port.getDetail).toHaveBeenCalledWith('issue-1', ORG, OFFICE)
    expect(port.list).not.toHaveBeenCalled()
  })

  it('returns an error pointing at the list for an id that does not resolve', async () => {
    const port = buildPort({
      getDetail: vi.fn(() =>
        Promise.reject(new NotFoundException('Community issue not found')),
      ),
    })
    expect(await build(port).execute({ id: 'made-up' })).toEqual({
      error:
        'No community issue with that id. Call read_community_issues without an id to list them.',
    })
  })

  it('lets any other failure throw', async () => {
    const port = buildPort({
      getDetail: vi.fn(() => Promise.reject(new Error('db down'))),
    })
    await expect(build(port).execute({ id: 'issue-1' })).rejects.toThrow(
      'db down',
    )
  })

  it('takes no id as valid input', () => {
    const tool = build(buildPort())
    expect(tool.inputSchema.safeParse({}).success).toBe(true)
  })
})
