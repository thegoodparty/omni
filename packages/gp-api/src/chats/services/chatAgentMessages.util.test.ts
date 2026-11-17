import { describe, expect, it } from 'vitest'
import { ChatMessageSegmentKind } from '../../generated/prisma'
import {
  agentMessagesToChatMessages,
  turnToAgentMessages,
} from './chatAgentMessages.util'

const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 }

const readBack = (drafts: NonNullable<ReturnType<typeof turnToAgentMessages>>) =>
  agentMessagesToChatMessages(
    drafts.map((d, i) => ({
      id: `r${i}`,
      conversationId: 'c',
      role: d.role,
      parts: d.parts,
      model: d.model ?? null,
      inputTokens: d.inputTokens ?? null,
      outputTokens: d.outputTokens ?? null,
      createdAt: new Date(0),
    })),
  )

describe('turnToAgentMessages', () => {
  it('keeps a citation where it streamed', () => {
    const segments = [
      { kind: ChatMessageSegmentKind.text, text: 'Per the memo' },
      {
        kind: ChatMessageSegmentKind.citation,
        payload: { attachmentId: 'a', quotedText: 'q' },
      },
      { kind: ChatMessageSegmentKind.text, text: ', yes.' },
    ]
    const drafts = turnToAgentMessages({
      content: 'Per the memo, yes.',
      segments,
      persistedSegments: segments,
      responseMessages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Per the memo, yes.' }],
        },
      ],
      stepUsages: [usage],
      model: 'm',
    })
    expect(drafts).not.toBeNull()
    const [message] = readBack(drafts!)
    expect(message!.content).toBe('Per the memo, yes.')
    expect(message!.segments.map((s) => s.kind)).toEqual([
      ChatMessageSegmentKind.text,
      ChatMessageSegmentKind.citation,
      ChatMessageSegmentKind.text,
    ])
  })

  it('reads a refused tool call back with no payload', () => {
    const segments = [
      {
        kind: ChatMessageSegmentKind.tool,
        toolName: 'present_card',
        toolCallId: 't1',
        payload: null,
      },
      { kind: ChatMessageSegmentKind.text, text: 'Sorry.' },
    ]
    const drafts = turnToAgentMessages({
      content: 'Sorry.',
      segments,
      persistedSegments: segments,
      responseMessages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 't1',
              toolName: 'present_card',
              input: { a: 1 },
            },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 't1',
              toolName: 'present_card',
              output: { type: 'json', value: { error: 'Count again.' } },
            },
          ],
        },
        { role: 'assistant', content: [{ type: 'text', text: 'Sorry.' }] },
      ],
      stepUsages: [usage, usage],
      model: 'm',
    })
    expect(drafts).not.toBeNull()
    expect(readBack(drafts!)[0]!.segments[0]!.payload).toBeNull()
  })

  it('returns null when the model messages do not match the stream', () => {
    expect(
      turnToAgentMessages({
        content: 'Hello',
        segments: [{ kind: ChatMessageSegmentKind.text, text: 'Hello' }],
        responseMessages: [
          {
            role: 'assistant',
            content: [
              {
                type: 'tool-call',
                toolCallId: 'unseen',
                toolName: 'x',
                input: {},
              },
            ],
          },
        ],
        stepUsages: [usage],
        model: 'm',
      }),
    ).toBeNull()
  })
})
