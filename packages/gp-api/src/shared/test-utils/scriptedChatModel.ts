import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { AIMessage, AIMessageChunk } from '@langchain/core/messages'
import { ChatGenerationChunk, type ChatResult } from '@langchain/core/outputs'

export type ScriptedReply = {
  text: string
  inputTokens?: number
  outputTokens?: number
}

const usageOf = (reply: ScriptedReply) => ({
  input_tokens: reply.inputTokens ?? 0,
  output_tokens: reply.outputTokens ?? 0,
  total_tokens: (reply.inputTokens ?? 0) + (reply.outputTokens ?? 0),
})

// A LangChain chat model that streams scripted text replies, one per call,
// with token usage, for tests of the LangGraph chat path. Once the script
// runs out it repeats its last reply. Tools are accepted and never called.
export class ScriptedChatModel extends BaseChatModel {
  private next = 0

  constructor(private readonly replies: ScriptedReply[]) {
    super({})
  }

  _llmType(): string {
    return 'scripted'
  }

  bindTools(): this {
    return this
  }

  private take(): ScriptedReply {
    const reply = this.replies[Math.min(this.next, this.replies.length - 1)]
    if (!reply) throw new Error('ScriptedChatModel has no replies')
    this.next += 1
    return reply
  }

  async _generate(): Promise<ChatResult> {
    const reply = this.take()
    return {
      generations: [
        {
          text: reply.text,
          message: new AIMessage({
            content: reply.text,
            usage_metadata: usageOf(reply),
          }),
        },
      ],
    }
  }

  async *_streamResponseChunks(
    _messages: unknown,
    _options: unknown,
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const reply = this.take()
    const chunk = new ChatGenerationChunk({
      text: reply.text,
      message: new AIMessageChunk({
        content: reply.text,
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
