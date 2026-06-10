import { renderHook } from '@testing-library/react'
import { useGenerationTiming } from './useGenerationTiming'

describe('useGenerationTiming', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports a plain cache fetch when generating was never observed', () => {
    const { result, rerender } = renderHook(
      ({ isGenerating }) => useGenerationTiming(isGenerating),
      { initialProps: { isGenerating: false } },
    )

    rerender({ isGenerating: false })

    expect(result.current()).toEqual({ generated: false })
  })

  it('reports generated with the wait measured from mount once the server reports generating', () => {
    vi.setSystemTime(10_000)
    const { result, rerender } = renderHook(
      ({ isGenerating }) => useGenerationTiming(isGenerating),
      { initialProps: { isGenerating: true } },
    )

    vi.setSystemTime(42_000)
    rerender({ isGenerating: false })

    expect(result.current()).toEqual({
      generated: true,
      generationTimeMs: 32_000,
    })
  })

  it('stays generated after the generating status clears', () => {
    const { result, rerender } = renderHook(
      ({ isGenerating }) => useGenerationTiming(isGenerating),
      { initialProps: { isGenerating: false } },
    )

    rerender({ isGenerating: true })
    rerender({ isGenerating: false })

    expect(result.current().generated).toBe(true)
  })
})
