import { anthropic } from '@ai-sdk/anthropic'
import { Injectable } from '@nestjs/common'
import type { LanguageModel } from 'ai'

// The one place a stage's model id becomes a provider model. Tests replace
// it with a mock model.
@Injectable()
export class AgentModels {
  languageModel(modelId: string): LanguageModel {
    return anthropic(modelId)
  }
}
