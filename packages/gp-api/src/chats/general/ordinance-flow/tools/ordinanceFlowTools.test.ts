import { describe, expect, it, vi } from 'vitest'
import { OrdinanceFlowToolsService } from '../services/ordinanceFlowTools.service'
import { OrdinanceFlowFetchService } from '../services/ordinanceFlowFetch.service'
import { OrdinanceFlowSearchService } from '../services/ordinanceFlowSearch.service'
import {
  buildApplyDraftEditTool,
  buildBraveSearchTool,
  type OrdinanceToolDeps,
} from './ordinanceFlowTools'

const buildDeps = (): {
  deps: OrdinanceToolDeps
  search: OrdinanceFlowSearchService
} => {
  const search = new OrdinanceFlowSearchService(
    { get: () => Promise.resolve({ kind: 'ok', status: 200, body: '{}' }) },
    'test-key',
  )
  return {
    search,
    deps: {
      service: {} as OrdinanceFlowToolsService,
      fetch: {} as OrdinanceFlowFetchService,
      search,
      ordinanceId: 'ord-1',
      electedOfficeId: 'eo-1',
      organizationSlug: 'org-1',
      step: 'current_law',
    },
  }
}

describe('buildBraveSearchTool', () => {
  it('rejects a query longer than 400 characters', () => {
    const { deps } = buildDeps()
    const schema = buildBraveSearchTool(deps).inputSchema
    expect(schema.safeParse({ query: 'a'.repeat(401) }).success).toBe(false)
    expect(schema.safeParse({ query: 'a'.repeat(400) }).success).toBe(true)
  })

  it('forwards the query and requested count to the search service', async () => {
    const { deps, search } = buildDeps()
    const spy = vi
      .spyOn(search, 'search')
      .mockResolvedValue({ ok: true, query: 'q', results: [] })

    await buildBraveSearchTool(deps).execute({ query: 'q' })
    expect(spy).toHaveBeenCalledWith('q', undefined)

    await buildBraveSearchTool(deps).execute({ query: 'q', count: 3 })
    expect(spy).toHaveBeenCalledWith('q', 3)
  })
})

describe('buildApplyDraftEditTool', () => {
  const deps: OrdinanceToolDeps = {
    service: {} as OrdinanceFlowToolsService,
    fetch: {} as OrdinanceFlowFetchService,
    search: {} as OrdinanceFlowSearchService,
    ordinanceId: 'ord-1',
    electedOfficeId: 'eo-1',
    organizationSlug: 'org-1',
    step: 'review',
  }

  it('requires a non-empty body', () => {
    const schema = buildApplyDraftEditTool(deps).inputSchema
    expect(schema.safeParse({ body: 'b' }).success).toBe(true)
    expect(schema.safeParse({}).success).toBe(false)
    expect(schema.safeParse({ body: '' }).success).toBe(false)
  })
})
