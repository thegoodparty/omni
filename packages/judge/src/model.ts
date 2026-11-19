import { anthropic } from '@ai-sdk/anthropic'
import type { LanguageModel } from 'ai'

// `--judge-model` is an AI SDK model id, e.g. `anthropic/claude-sonnet-4-6`. The
// prefix names the provider; the rest is that provider's own model id, which is
// exactly how the AI Gateway spells one. So swapping providers is a flag change
// and nothing here imports a provider SDK beyond the one-line map below.
//
// The provider's own key goes in that provider's standard environment variable
// (`ANTHROPIC_API_KEY` here), and a missing key surfaces on the first grading
// call — a run that never got as far as writing a verdict. A prefix this map
// does not know falls back to the AI SDK's default provider (the gateway), so a
// gateway-routed id still works with `AI_GATEWAY_API_KEY`.
const PROVIDERS: Record<string, (modelId: string) => LanguageModel> = {
  anthropic,
}

export const resolveJudgeModel = (judgeModel: string): LanguageModel => {
  const [prefix, ...rest] = judgeModel.split('/')
  if (!prefix || rest.length === 0 || rest.join('/') === '') {
    throw new Error(
      `--judge-model must be an AI SDK model id like 'anthropic/claude-sonnet-4-6', got '${judgeModel}'`,
    )
  }
  const provider = PROVIDERS[prefix]
  return provider ? provider(rest.join('/')) : (judgeModel as LanguageModel)
}
