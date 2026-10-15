import type { ChatConversationUsage } from '@goodparty_org/contracts'
import { ChatMessage, ChatMessageRole } from '../../generated/prisma'

export const summarizeConversationUsage = (
  messages: Pick<
    ChatMessage,
    'role' | 'model' | 'inputTokens' | 'outputTokens'
  >[],
): ChatConversationUsage => {
  const assistant = messages.filter((m) => m.role === ChatMessageRole.assistant)
  const byModel = new Map<
    string,
    { model: string; inputTokens: number; outputTokens: number }
  >()
  for (const m of assistant) {
    if (m.model === null) continue
    const total = byModel.get(m.model) ?? {
      model: m.model,
      inputTokens: 0,
      outputTokens: 0,
    }
    total.inputTokens += m.inputTokens ?? 0
    total.outputTokens += m.outputTokens ?? 0
    byModel.set(m.model, total)
  }
  return {
    complete: assistant.every((m) => m.inputTokens !== null),
    byModel: [...byModel.values()],
  }
}
