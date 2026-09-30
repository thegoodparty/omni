import { subDays, subSeconds } from 'date-fns'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchAllOpenPrs,
  type OpenPr,
  parseIdleDays,
  selectStaleStacks,
} from './find-stale-preview-stacks'

const now = new Date('2026-09-30T12:00:00Z')
const daysAgo = (days: number) => subDays(now, days).toISOString()

describe('selectStaleStacks', () => {
  it('marks a stack stale when its PR is not open', () => {
    expect(selectStaleStacks(['gp-api-pr-1'], [], now, 21)).toEqual([
      'gp-api-pr-1',
    ])
  })

  it('keeps a stack whose PR is open and recently updated', () => {
    const prs: OpenPr[] = [{ number: 2, updated_at: daysAgo(3) }]
    expect(selectStaleStacks(['gp-api-pr-2'], prs, now, 21)).toEqual([])
  })

  it('marks a stack stale when its open PR is idle past the threshold', () => {
    const prs: OpenPr[] = [{ number: 3, updated_at: daysAgo(90) }]
    expect(selectStaleStacks(['gp-api-pr-3'], prs, now, 21)).toEqual([
      'gp-api-pr-3',
    ])
  })

  it('keeps a PR exactly at the threshold and retires one past it', () => {
    const threshold = subDays(now, 21)
    const prs: OpenPr[] = [
      { number: 4, updated_at: threshold.toISOString() },
      { number: 5, updated_at: subSeconds(threshold, 1).toISOString() },
    ]
    expect(
      selectStaleStacks(['gp-api-pr-4', 'gp-api-pr-5'], prs, now, 21),
    ).toEqual(['gp-api-pr-5'])
  })
})

describe('parseIdleDays', () => {
  it('defaults to 21 when unset or blank', () => {
    expect(parseIdleDays(undefined)).toBe(21)
    expect(parseIdleDays('')).toBe(21)
  })

  it('reads a configured value', () => {
    expect(parseIdleDays('14')).toBe(14)
  })

  it('rejects a value that is not a positive number', () => {
    expect(() => parseIdleDays('abc')).toThrow()
    expect(() => parseIdleDays('0')).toThrow()
  })
})

describe('fetchAllOpenPrs', () => {
  const page = (start: number, count: number) =>
    Array.from({ length: count }, (_, i) => ({
      number: start + i,
      updated_at: daysAgo(1),
      title: 'ignored',
    }))

  it('follows a full page to the next and stops on a partial one', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(Response.json(page(1, 100)))
      .mockResolvedValueOnce(Response.json(page(101, 7)))

    const prs = await fetchAllOpenPrs(fetchFn, 'owner/repo', 'token')

    expect(prs).toHaveLength(107)
    expect(prs.at(-1)).toEqual({ number: 107, updated_at: daysAgo(1) })
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(fetchFn.mock.calls[0]?.[0]).toContain('page=1')
    expect(fetchFn.mock.calls[1]?.[0]).toContain('page=2')
  })

  it('throws when any page fails instead of returning a short list', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(Response.json(page(1, 100)))
      .mockResolvedValueOnce(new Response('nope', { status: 502 }))

    await expect(
      fetchAllOpenPrs(fetchFn, 'owner/repo', 'token'),
    ).rejects.toThrow('page 2')
  })
})
