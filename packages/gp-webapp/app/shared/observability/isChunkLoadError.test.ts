import { describe, expect, it } from 'vitest'
import { isChunkLoadError } from './isChunkLoadError'

describe('isChunkLoadError', () => {
  it('recognizes the webpack message', () => {
    expect(isChunkLoadError(new Error('Loading chunk 4 failed'))).toBe(true)
  })

  it('recognizes the Turbopack message', () => {
    const error = new Error(
      'Failed to load chunk /_next/static/chunks/17bg_j5w-edpf.js from module 355143',
    )

    expect(isChunkLoadError(error)).toBe(true)
  })

  it('recognizes the error by name when the message is rewritten', () => {
    const error = new Error('Something else entirely')
    error.name = 'ChunkLoadError'

    expect(isChunkLoadError(error)).toBe(true)
  })

  it('does not treat another error as a chunk-load error', () => {
    expect(isChunkLoadError(new Error('Connection closed'))).toBe(false)
  })

  it('does not treat a missing error as a chunk-load error', () => {
    expect(isChunkLoadError(undefined)).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
  })
})
