import { describe, expect, it, vi } from 'vitest'
import {
  fetchAllOpenPrs,
  type OpenPr,
  selectStaleStacks,
} from './find-stale-preview-stacks'

describe('selectStaleStacks', () => {
  it('marks a stack stale when its PR is not open', () => {
    expect(selectStaleStacks(['gp-api-pr-1'], [])).toEqual(['gp-api-pr-1'])
  })

  it('keeps a stack whose PR is open', () => {
    const prs: OpenPr[] = [{ number: 2 }]
    expect(selectStaleStacks(['gp-api-pr-2'], prs)).toEqual([])
  })

  it('never selects a stack whose name is not gp-api-pr-<n>', () => {
    expect(selectStaleStacks(['gp-api-pr-7-extra', 'gp-api-pr-'], [])).toEqual(
      [],
    )
  })
})

describe('fetchAllOpenPrs', () => {
  const page = (start: number, count: number) =>
    Array.from({ length: count }, (_, i) => ({
      number: start + i,
      title: 'ignored',
    }))

  it('follows a full page to the next and stops on a partial one', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(Response.json(page(1, 100)))
      .mockResolvedValueOnce(Response.json(page(101, 7)))

    const prs = await fetchAllOpenPrs(fetchFn, 'owner/repo', 'token')

    expect(prs).toHaveLength(107)
    expect(prs.at(-1)).toEqual({ number: 107 })
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
