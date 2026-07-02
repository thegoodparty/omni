import { describe, it, expect } from 'vitest'
import { DEFAULT_PER_PAGE } from '@/app/dashboard/users/types'
import {
  SEARCH_PARAMS,
  STATUS_BADGE_COLORS,
  STATUS_BADGE_LABELS,
  buildAgentRunsQuery,
  formatCost,
  formatDuration,
  formatTimestamp,
  isAgentRunStatus,
} from './types'

describe('buildAgentRunsQuery', () => {
  it('defaults to page 1 with the default page size', () => {
    const query = buildAgentRunsQuery({})
    expect(query).toEqual({ limit: DEFAULT_PER_PAGE, offset: 0 })
  })

  it('computes offset from page and per-page', () => {
    const query = buildAgentRunsQuery({
      [SEARCH_PARAMS.PAGE]: 3,
      [SEARCH_PARAMS.PER_PAGE]: 10,
    })
    expect(query.limit).toBe(10)
    expect(query.offset).toBe(20)
  })

  it('maps every filter param to its query field', () => {
    const query = buildAgentRunsQuery({
      [SEARCH_PARAMS.EXPERIMENT_TYPE]: 'compliance_setup',
      [SEARCH_PARAMS.STATUS]: 'COMPLETED',
      [SEARCH_PARAMS.ORGANIZATION]: 'acme',
      [SEARCH_PARAMS.CREATED_AFTER]: '2026-06-01',
      [SEARCH_PARAMS.CREATED_BEFORE]: '2026-06-02',
    })
    expect(query.experimentType).toBe('compliance_setup')
    expect(query.status).toBe('COMPLETED')
    expect(query.organizationSlug).toBe('acme')
    expect(query.createdAfter?.toISOString()).toBe('2026-06-01T00:00:00.000Z')
    expect(query.createdBefore?.toISOString()).toBe('2026-06-02T00:00:00.000Z')
  })

  it('omits absent and empty filters', () => {
    const query = buildAgentRunsQuery({
      [SEARCH_PARAMS.EXPERIMENT_TYPE]: '',
      [SEARCH_PARAMS.ORGANIZATION]: undefined,
    })
    expect(query).not.toHaveProperty('experimentType')
    expect(query).not.toHaveProperty('organizationSlug')
    expect(query).not.toHaveProperty('status')
    expect(query).not.toHaveProperty('createdAfter')
    expect(query).not.toHaveProperty('createdBefore')
  })
})

describe('isAgentRunStatus', () => {
  it('accepts the known statuses', () => {
    expect(isAgentRunStatus('RUNNING')).toBe(true)
    expect(isAgentRunStatus('COMPLETED')).toBe(true)
    expect(isAgentRunStatus('FAILED')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isAgentRunStatus('running')).toBe(false)
    expect(isAgentRunStatus('PENDING')).toBe(false)
    expect(isAgentRunStatus('')).toBe(false)
  })

  it('accepts SUPERSEDED as a filterable status', () => {
    expect(isAgentRunStatus('SUPERSEDED')).toBe(true)
  })
})

describe('SUPERSEDED badge presentation', () => {
  it('renders green (a benign hand-off, not a failure)', () => {
    expect(STATUS_BADGE_COLORS.SUPERSEDED).toBe('green')
    expect(STATUS_BADGE_COLORS.FAILED).toBe('red')
  })

  it('relabels SUPERSEDED to "Part 1 completed"', () => {
    expect(STATUS_BADGE_LABELS.SUPERSEDED).toBe('Part 1 completed')
  })
})

describe('formatTimestamp', () => {
  it('returns a dash for null', () => {
    expect(formatTimestamp(null)).toBe('—')
  })

  it('normalises an ISO string and a Date to the same output', () => {
    const date = new Date('2026-06-01T12:34:00.000Z')
    expect(formatTimestamp(date.toISOString())).toBe(formatTimestamp(date))
  })
})

describe('formatDuration', () => {
  it('returns a dash for null', () => {
    expect(formatDuration(null)).toBe('—')
  })

  it('renders sub-minute durations in seconds', () => {
    expect(formatDuration(45)).toBe('45s')
  })

  it('renders longer durations as minutes and seconds', () => {
    expect(formatDuration(90)).toBe('1m 30s')
    expect(formatDuration(60)).toBe('1m 0s')
  })
})

describe('formatCost', () => {
  it('returns a dash for null', () => {
    expect(formatCost(null)).toBe('—')
  })

  it('formats cents with a leading dollar sign', () => {
    expect(formatCost(0)).toBe('$0.00')
    expect(formatCost(1.5)).toBe('$1.50')
  })
})
