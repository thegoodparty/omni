import { describe, expect, it } from 'vitest'
import { chatApi } from './chat-api'
import { api } from 'helpers/test-utils/api-mocking'

describe('chatApi.createBriefingChat', () => {
  it('POSTs to /v1/briefing-chats with meetingDate + anchor and returns annotationId + conversationId', async () => {
    let receivedBody: unknown
    api.mock('POST /v1/briefing-chats', ({ body }) => {
      receivedBody = body
      return {
        status: 200,
        data: {
          annotationId: 'ann_123',
          conversationId: 'conv_456',
        },
      }
    })

    const result = await chatApi.createBriefingChat({
      meetingDate: 'briefing_abc',
      anchor: { jsonPath: 'agenda.0.title', start: 4, end: 10 },
    })

    expect(result).toEqual({
      annotationId: 'ann_123',
      conversationId: 'conv_456',
    })
    expect(receivedBody).toEqual({
      meetingDate: 'briefing_abc',
      anchor: { jsonPath: 'agenda.0.title', start: 4, end: 10 },
    })
  })

  it('throws when the server responds with a non-2xx status', async () => {
    api.mock('POST /v1/briefing-chats', {
      status: 500,
      data: { message: 'boom' },
    })

    await expect(
      chatApi.createBriefingChat({
        meetingDate: 'b',
        anchor: { jsonPath: null, start: null, end: null },
      }),
    ).rejects.toThrow(/500/)
  })
})

describe('chatApi.softDelete', () => {
  it('DELETEs the annotation-keyed endpoint and accepts a 200 response', async () => {
    let receivedAnnotationId: string | undefined
    api.mock('DELETE /v1/briefing-chats/:annotationId', ({ params }) => {
      receivedAnnotationId = params.annotationId
      return { status: 200, data: undefined }
    })

    await expect(chatApi.softDelete('ann_abc')).resolves.toBeUndefined()
    expect(receivedAnnotationId).toBe('ann_abc')
  })

  it('throws on non-2xx response', async () => {
    api.mock('DELETE /v1/briefing-chats/:annotationId', {
      status: 500,
      data: { message: 'err' },
    })
    await expect(chatApi.softDelete('ann_x')).rejects.toThrow(/500/)
  })
})
