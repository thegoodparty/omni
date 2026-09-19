import { describe, expect, it } from 'vitest'
import {
  CHAT_ATTACHMENT_MAX_BYTES,
  ChatMessageSegmentCitationPayloadSchema,
  FinalizeRequestSchema,
  LinkAttachRequestSchema,
  PresignRequestSchema,
} from './ChatAttachment.schema'

const validPresign = {
  fileName: 'contract.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1024,
}

describe('PresignRequestSchema', () => {
  it('accepts a valid payload', () => {
    expect(() => PresignRequestSchema.parse(validPresign)).not.toThrow()
  })

  it('rejects sizeBytes of zero', () => {
    expect(() =>
      PresignRequestSchema.parse({ ...validPresign, sizeBytes: 0 }),
    ).toThrow()
  })

  it('rejects sizeBytes above the max', () => {
    expect(() =>
      PresignRequestSchema.parse({
        ...validPresign,
        sizeBytes: CHAT_ATTACHMENT_MAX_BYTES + 1,
      }),
    ).toThrow()
  })

  it('accepts sizeBytes exactly at the max', () => {
    expect(() =>
      PresignRequestSchema.parse({
        ...validPresign,
        sizeBytes: CHAT_ATTACHMENT_MAX_BYTES,
      }),
    ).not.toThrow()
  })

  it('rejects a mime type outside the allowlist', () => {
    expect(() =>
      PresignRequestSchema.parse({ ...validPresign, mimeType: 'text/html' }),
    ).toThrow()
  })

  it('rejects an empty fileName', () => {
    expect(() =>
      PresignRequestSchema.parse({ ...validPresign, fileName: '' }),
    ).toThrow()
  })

  it('rejects a fileName longer than 255 characters', () => {
    expect(() =>
      PresignRequestSchema.parse({
        ...validPresign,
        fileName: 'a'.repeat(256),
      }),
    ).toThrow()
  })

  it('rejects extra keys', () => {
    expect(() =>
      PresignRequestSchema.parse({ ...validPresign, storageKey: 'sneaky' }),
    ).toThrow()
  })
})

describe('LinkAttachRequestSchema', () => {
  it('accepts a valid url', () => {
    expect(() =>
      LinkAttachRequestSchema.parse({ url: 'https://example.com/doc' }),
    ).not.toThrow()
  })

  it('rejects a non-url string', () => {
    expect(() => LinkAttachRequestSchema.parse({ url: 'not a url' })).toThrow()
  })
})

describe('FinalizeRequestSchema', () => {
  it('accepts a storage key', () => {
    expect(() =>
      FinalizeRequestSchema.parse({ storageKey: 'chat-attachments/1/abc' }),
    ).not.toThrow()
  })

  it('rejects extra keys', () => {
    expect(() =>
      FinalizeRequestSchema.parse({
        storageKey: 'chat-attachments/1/abc',
        fileName: 'sneaky.pdf',
      }),
    ).toThrow()
  })
})

describe('ChatMessageSegmentCitationPayloadSchema', () => {
  it('accepts a payload without the optional anchors', () => {
    expect(() =>
      ChatMessageSegmentCitationPayloadSchema.parse({
        attachmentId: 'att-1',
        quotedText: 'the cited passage',
      }),
    ).not.toThrow()
  })

  it('accepts a page-anchored payload', () => {
    expect(() =>
      ChatMessageSegmentCitationPayloadSchema.parse({
        attachmentId: 'att-1',
        page: 3,
        quotedText: 'the cited passage',
      }),
    ).not.toThrow()
  })

  it('accepts a char-range-anchored payload', () => {
    expect(() =>
      ChatMessageSegmentCitationPayloadSchema.parse({
        attachmentId: 'att-1',
        charRange: [10, 42],
        quotedText: 'the cited passage',
      }),
    ).not.toThrow()
  })
})
