import { describe, expect, it } from 'vitest'
import {
  briefingChatTurns,
  chatTurns,
  type BriefingChatTurnsInput,
  type ChatTurnsInput,
} from './chatTurns'
import type { EvalApi, EvalContext } from './suite'

// A fake arm: the chat routes over an in-memory counter, and the SSE body built
// the way the controllers build it — one `data: <json>\n\n` per chunk.
const asStream = (chunks: object[]): string =>
  chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')

const textOf = (reply: string): object[] => [
  { type: 'text', delta: reply.slice(0, 3) },
  { type: 'text', delta: reply.slice(3) },
  { type: 'done', assistantMessageId: 'm-1' },
]

const fakeArm = (replies: readonly string[]) => {
  const posts: { path: string; body: unknown }[] = []
  const annotations: { message: string; type: string }[] = []
  let conversations = 0
  let turn = 0

  const answer = (path: string): unknown => {
    if (path === '/v1/chats') {
      conversations += 1
      return { conversationId: `conversation-${conversations}`, created: true }
    }
    if (path === '/v1/briefing-chats') {
      conversations += 1
      return {
        conversationId: `briefing-conversation-${conversations}`,
        annotationId: 'annotation-1',
      }
    }
    throw new Error(`unexpected POST ${path}`)
  }

  const api: EvalApi = {
    get: async () => {
      throw new Error('a chat suite reads nothing')
    },
    put: async () => {
      throw new Error('a chat suite writes nothing')
    },
    post: async <T = unknown>(path: string, body?: unknown) => {
      posts.push({ path, body })
      return answer(path) as T
    },
  }

  const ctx: EvalContext = {
    api,
    postEventStream: async (path, body) => {
      posts.push({ path, body })
      const reply = replies[turn]
      turn += 1
      if (reply === undefined) throw new Error(`no reply for ${path}`)
      return asStream(textOf(reply))
    },
    annotate: async (message, type) => {
      annotations.push({ message, type })
    },
    baseUrl: 'https://arm.invalid',
    org: { slug: 'eo-1' },
    runAgent: async () => {
      throw new Error('a chat suite never runs a background agent')
    },
  }

  return { ctx, posts, annotations }
}

describe('chatTurns', () => {
  it('opens the conversation, posts every turn to it and labels the transcript', async () => {
    const arm = fakeArm(['first reply', 'second reply'])
    const input: ChatTurnsInput = {
      scope: 'chief_of_staff',
      turns: ['first question', 'second question'],
    }
    const output = await chatTurns(arm.ctx, input)

    expect(output).toBe(
      [
        'User: first question\nAssistant: first reply',
        'User: second question\nAssistant: second reply',
      ].join('\n\n'),
    )
    expect(arm.posts).toEqual([
      { path: '/v1/chats', body: { scope: 'chief_of_staff' } },
      {
        path: '/v1/chats/conversation-1/messages?scope=chief_of_staff',
        body: { content: 'first question' },
      },
      {
        path: '/v1/chats/conversation-1/messages?scope=chief_of_staff',
        body: { content: 'second question' },
      },
    ])
  })

  it('carries the anchor the anchored scopes require', async () => {
    const arm = fakeArm(['reply'])
    await chatTurns(arm.ctx, {
      scope: 'priority_flow',
      anchor: {
        resourceType: 'priority',
        resourceId: 'pri-1',
        url: '/dashboard/priorities/pri-1',
        snapshot: { title: 'Affordable housing', summary: 'Expand supply.' },
      },
      turns: ['hello'],
    })
    expect(arm.posts[0]?.body).toEqual({
      scope: 'priority_flow',
      anchor: {
        resourceType: 'priority',
        resourceId: 'pri-1',
        url: '/dashboard/priorities/pri-1',
        snapshot: { title: 'Affordable housing', summary: 'Expand supply.' },
      },
    })
  })

  it('annotates each turn with the scope and conversation', async () => {
    const arm = fakeArm(['a reply worth reading'])
    await chatTurns(arm.ctx, { scope: 'campaign_assistant', turns: ['ask'] })
    expect(arm.annotations).toHaveLength(1)
    expect(arm.annotations[0]?.type).toBe('chat-turn')
    expect(arm.annotations[0]?.message).toContain('campaign_assistant')
    expect(arm.annotations[0]?.message).toContain('conversation-1')
    expect(arm.annotations[0]?.message).toContain('a reply worth reading')
  })

  it('refuses a stream that errored', async () => {
    const arm = fakeArm([])
    await expect(
      chatTurns(
        {
          ...arm.ctx,
          postEventStream: async () =>
            asStream([
              { type: 'text', delta: 'half an ans' },
              {
                type: 'error',
                code: 'upstream_unavailable',
                message: 'Chat stream failed.',
              },
            ]),
        },
        { scope: 'chief_of_staff', turns: ['ask'] },
      ),
    ).rejects.toThrow(/streamed an error: Chat stream failed/)
  })

  it('refuses a stream that ended without a done frame', async () => {
    const arm = fakeArm([])
    await expect(
      chatTurns(
        {
          ...arm.ctx,
          postEventStream: async () =>
            asStream([{ type: 'text', delta: 'half an ans' }]),
        },
        { scope: 'chief_of_staff', turns: ['ask'] },
      ),
    ).rejects.toThrow(/ended without a done frame/)
  })

  it('tolerates keep-alives and tool frames between the text', async () => {
    const arm = fakeArm([])
    const output = await chatTurns(
      {
        ...arm.ctx,
        postEventStream: async () =>
          asStream([
            { type: 'ping' },
            { type: 'tool_call', toolName: 't', args: {}, toolCallId: 'c-1' },
            { type: 'text', delta: 'grounded' },
            { type: 'ping' },
            { type: 'done' },
          ]),
      },
      { scope: 'chief_of_staff', turns: ['ask'] },
    )
    expect(output).toBe('User: ask\nAssistant: grounded')
  })
})

describe('briefingChatTurns', () => {
  it('opens on the annotation routes and posts every turn to its id', async () => {
    const arm = fakeArm(['a briefing reply'])
    const input: BriefingChatTurnsInput = {
      meetingDate: '2026-05-19',
      anchor: { jsonPath: null, start: null, end: null },
      turns: ['what is this meeting about'],
    }
    const output = await briefingChatTurns(arm.ctx, input)

    expect(output).toBe(
      'User: what is this meeting about\nAssistant: a briefing reply',
    )
    expect(arm.posts).toEqual([
      {
        path: '/v1/briefing-chats',
        body: {
          meetingDate: '2026-05-19',
          anchor: { jsonPath: null, start: null, end: null },
        },
      },
      {
        path: '/v1/chats/briefing-conversation-1/messages?scope=briefing_annotation',
        body: { content: 'what is this meeting about' },
      },
    ])
    expect(arm.annotations[0]?.message).toContain('briefing_annotation')
    expect(arm.annotations[0]?.message).toContain('briefing-conversation-1')
  })
})
