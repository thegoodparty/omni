import { describe, expect, it } from 'vitest'
import { fetchPage } from './fetchPage'
import {
  aiSdkWebSearch,
  isProviderWebSearch,
  langChainWebSearch,
  webSearch,
} from './webSearch'

describe('webSearch', () => {
  it('is marked as a provider tool so engines register it instead of calling it', () => {
    expect(isProviderWebSearch(webSearch)).toBe(true)
    expect(isProviderWebSearch(fetchPage)).toBe(false)
  })

  it('maps to Anthropic web search in both engines', () => {
    expect(aiSdkWebSearch(webSearch)).toMatchObject({
      type: 'provider',
      id: 'anthropic.web_search_20250305',
    })
    expect(langChainWebSearch(webSearch)).toEqual({
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: 5,
    })
  })
})
