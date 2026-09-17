import { describe, expect, it, vi } from 'vitest'
import { buildSearchHelpCenterTool } from './searchHelpCenter.tool'

const tool = (search = vi.fn().mockResolvedValue({ articles: [] })) => ({
  search,
  instance: buildSearchHelpCenterTool({ helpCenter: { search } }),
})

describe('search_help_center tool', () => {
  it('passes the query straight through to the service', async () => {
    const { search, instance } = tool()

    await instance.execute({ query: 'cancel my subscription' })

    expect(search).toHaveBeenCalledWith('cancel my subscription')
  })

  it('rejects a smuggled key, so the description stays true', () => {
    const { instance } = tool()

    const parsed = instance.inputSchema.safeParse({
      query: 'billing',
      portalId: '999',
    })

    expect(parsed.success).toBe(false)
  })

  it('requires a query with something in it', () => {
    const { instance } = tool()

    expect(instance.inputSchema.safeParse({ query: 'a' }).success).toBe(false)
    expect(instance.inputSchema.safeParse({ query: 'ab' }).success).toBe(true)
  })

  it('tells the model to search before handing off', () => {
    expect(tool().instance.description).toContain('before you hand')
  })
})
