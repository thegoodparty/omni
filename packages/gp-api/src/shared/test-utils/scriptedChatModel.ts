import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import {
  AIMessage,
  AIMessageChunk,
  type BaseMessage,
} from '@langchain/core/messages'
import { ChatGenerationChunk, type ChatResult } from '@langchain/core/outputs'

export type ScriptedReply = {
  text: string
  toolCalls?: { name: string; args: Record<string, unknown>; id: string }[]
  inputTokens?: number
  outputTokens?: number
}

const usageOf = (reply: ScriptedReply) => ({
  input_tokens: reply.inputTokens ?? 0,
  output_tokens: reply.outputTokens ?? 0,
  total_tokens: (reply.inputTokens ?? 0) + (reply.outputTokens ?? 0),
})

// A LangChain chat model that streams scripted replies, one per call, with
// token usage and optional tool calls, for tests of the LangGraph chat path.
// Once the script runs out it repeats its last reply. `onCall` sees the
// messages of every call.
export class ScriptedChatModel extends BaseChatModel {
  private next = 0

  constructor(
    private readonly replies: ScriptedReply[],
    private readonly onCall?: (messages: BaseMessage[]) => void,
  ) {
    super({})
  }

  _llmType(): string {
    return 'scripted'
  }

  bindTools(): this {
    return this
  }

  private take(messages: BaseMessage[]): ScriptedReply {
    this.onCall?.(messages)
    const reply = this.replies[Math.min(this.next, this.replies.length - 1)]
    if (!reply) throw new Error('ScriptedChatModel has no replies')
    this.next += 1
    return reply
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const reply = this.take(messages)
    return {
      generations: [
        {
          text: reply.text,
          message: new AIMessage({
            content: reply.text,
            tool_calls: (reply.toolCalls ?? []).map((call) => ({
              ...call,
              type: 'tool_call' as const,
            })),
            usage_metadata: usageOf(reply),
          }),
        },
      ],
    }
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    _options: unknown,
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const reply = this.take(messages)
    const chunk = new ChatGenerationChunk({
      text: reply.text,
      message: new AIMessageChunk({
        content: reply.text,
        tool_call_chunks: (reply.toolCalls ?? []).map((call, index) => ({
          name: call.name,
          args: JSON.stringify(call.args),
          id: call.id,
          index,
          type: 'tool_call_chunk' as const,
        })),
        usage_metadata: usageOf(reply),
      }),
    })
    await runManager?.handleLLMNewToken(
      reply.text,
      undefined,
      undefined,
      undefined,
      undefined,
      { chunk },
    )
    yield chunk
  }
}
