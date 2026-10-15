import { describe, expect, it } from 'vitest'
import { getImageAspectWarning } from './imageAspect'

describe('getImageAspectWarning', () => {
  it('passes square, portrait and landscape photos', () => {
    expect(getImageAspectWarning(1080, 1080)).toBeNull()
    expect(getImageAspectWarning(1080, 1920)).toBeNull()
    expect(getImageAspectWarning(1920, 1080)).toBeNull()
  })

  it('passes images exactly at the limits', () => {
    expect(getImageAspectWarning(1000, 2000)).toBeNull()
    expect(getImageAspectWarning(2000, 1000)).toBeNull()
  })

  it('flags an image taller than 1:2', () => {
    expect(getImageAspectWarning(600, 2400)).toBe('tall')
  })

  it('flags an image wider than 2:1', () => {
    expect(getImageAspectWarning(2400, 300)).toBe('wide')
  })

  it('ignores an image with no size', () => {
    expect(getImageAspectWarning(0, 0)).toBeNull()
    expect(getImageAspectWarning(600, 0)).toBeNull()
  })
})
