import { describe, expect, it } from 'vitest'
import { DEFAULT_PER_PAGE } from '@/app/dashboard/users/types'
import {
  BACKGROUND_AGENT_RUN_STATUSES,
  SEARCH_PARAMS,
  STATUS_BADGE_COLORS,
  buildBackgroundAgentRunsQuery,
  formatDuration,
  formatTimestamp,
  formatTokens,
  isBackgroundAgentRunStatus,
} from './types'

describe('buildBackgroundAgentRunsQuery', () => {
  it('defaults to page 1 with the default page size', () => {
    expect(buildBackgroundAgentRunsQuery({})).toEqual({
      limit: DEFAULT_PER_PAGE,
      offset: 0,
    })
  })

  it('computes offset from page and per-page', () => {
    const query = buildBackgroundAgentRunsQuery({
      [SEARCH_PARAMS.PAGE]: 3,
      [SEARCH_PARAMS.PER_PAGE]: 10,
    })
    expect(query.limit).toBe(10)
    expect(query.offset).toBe(20)
  })

  it('maps every filter param to its query field', () => {
    const query = buildBackgroundAgentRunsQuery({
      [SEARCH_PARAMS.AGENT_NAME]: 'trending_issues',
      [SEARCH_PARAMS.STATUS]: 'completed',
      [SEARCH_PARAMS.ORGANIZATION]: 'acme',
      [SEARCH_PARAMS.CREATED_AFTER]: '2026-06-01',
      [SEARCH_PARAMS.CREATED_BEFORE]: '2026-06-02',
    })
    expect(query.agentName).toBe('trending_issues')
    expect(query.status).toBe('completed')
    expect(query.organizationSlug).toBe('acme')
    expect(query.createdAfter?.toISOString()).toBe('2026-06-01T00:00:00.000Z')
    expect(query.createdBefore?.toISOString()).toBe('2026-06-02T00:00:00.000Z')
  })

  it('omits absent and empty filters', () => {
    const query = buildBackgroundAgentRunsQuery({
      [SEARCH_PARAMS.AGENT_NAME]: '',
      [SEARCH_PARAMS.ORGANIZATION]: undefined,
    })
    expect(query).not.toHaveProperty('agentName')
    expect(query).not.toHaveProperty('organizationSlug')
    expect(query).not.toHaveProperty('status')
    expect(query).not.toHaveProperty('createdAfter')
    expect(query).not.toHaveProperty('createdBefore')
  })
})

describe('isBackgroundAgentRunStatus', () => {
  it('accepts every status in the contract', () => {
    for (const status of BACKGROUND_AGENT_RUN_STATUSES) {
      expect(isBackgroundAgentRunStatus(status)).toBe(true)
    }
  })

  it('rejects the PMF Engine statuses the old page filters on', () => {
    expect(isBackgroundAgentRunStatus('COMPLETED')).toBe(false)
    expect(isBackgroundAgentRunStatus('AWAITING_RESUME')).toBe(false)
  })
})

describe('STATUS_BADGE_COLORS', () => {
  it('has a colour for every status', () => {
    expect(Object.keys(STATUS_BADGE_COLORS).sort()).toEqual(
      [...BACKGROUND_AGENT_RUN_STATUSES].sort()
    )
  })
})

describe('formatDuration', () => {
  it('renders seconds, minutes and the missing case', () => {
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(45)).toBe('45s')
    expect(formatDuration(150)).toBe('2m 30s')
  })
})

describe('formatTimestamp', () => {
  it('renders a date, accepts an ISO string, and dashes a null', () => {
    expect(formatTimestamp('2026-06-01T00:00:00.000Z')).toContain('2026')
    expect(formatTimestamp(new Date('2026-06-01T00:00:00.000Z'))).toContain(
      '2026'
    )
    expect(formatTimestamp(null)).toBe('—')
  })
})

describe('formatTokens', () => {
  it('groups thousands and dashes a null', () => {
    expect(formatTokens(1000)).toBe('1,000')
    expect(formatTokens(null)).toBe('—')
  })
})
