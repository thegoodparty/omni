import { describe, expect, it } from 'vitest'
import {
  OutreachArchiveRequestSchema,
  OutreachArchiveResponseSchema,
} from './OutreachArchive.schema'

describe('OutreachArchiveRequestSchema', () => {
  it('accepts an archive request', () => {
    expect(() =>
      OutreachArchiveRequestSchema.parse({ archived: true }),
    ).not.toThrow()
  })

  it('accepts a restore (unarchive) request', () => {
    expect(() =>
      OutreachArchiveRequestSchema.parse({ archived: false }),
    ).not.toThrow()
  })

  it('rejects a missing archived flag', () => {
    expect(() => OutreachArchiveRequestSchema.parse({})).toThrow()
  })
})

describe('OutreachArchiveResponseSchema', () => {
  it('accepts an archived row', () => {
    const response = {
      id: 1,
      archivedAt: '2026-08-20T12:00:00Z',
    }
    expect(() => OutreachArchiveResponseSchema.parse(response)).not.toThrow()
  })

  it('accepts a restored row with a null archivedAt', () => {
    const response = { id: 1, archivedAt: null }
    expect(() => OutreachArchiveResponseSchema.parse(response)).not.toThrow()
  })
})
