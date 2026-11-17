import { anthropic } from '@ai-sdk/anthropic'
import { Injectable } from '@nestjs/common'
import type { LanguageModel } from 'ai'

// One agent's model, resolved: what to call, and who serves it.
export type AgentModel = {
  model: LanguageModel
  // The model id as the provider names it (`claude-sonnet-4-6`), which is what
  // an assistant AgentMessage row records.
  modelId: string
  // The provider's name, for spans (`anthropic`, `bedrock`, ...). Swapping a
  // model to another provider is this file and the agent's `model` line.
  provider: string
}

// The one place an agent's model id becomes a provider model, so the provider
// is swappable through the AI SDK rather than a code path in the agents code.
// Each provider reads its own credentials from the environment. Tests replace
// this with a mock model.
@Injectable()
export class AgentModels {
  resolve(modelId: string): AgentModel {
    return { model: anthropic(modelId), modelId, provider: 'anthropic' }
  }
}
