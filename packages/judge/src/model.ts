import type { LanguageModel } from 'ai'

// `--judge-model` is an AI SDK model id, e.g. `anthropic/claude-sonnet-4-6`. The
// AI SDK resolves such an id through its default provider (the AI Gateway),
// which is why the flag is the only thing naming a provider and swapping
// providers is a flag change: nothing here imports a provider SDK.
//
// The provider's own key goes in that provider's standard environment variable
// (`AI_GATEWAY_API_KEY` for the gateway); a missing key surfaces on the first
// grading call, which is a run that never got as far as writing a verdict.
export type JudgeModelId = LanguageModel

export const resolveJudgeModel = (judgeModel: string): LanguageModel => {
  if (!judgeModel.includes('/')) {
    throw new Error(
      `--judge-model must be an AI SDK model id like 'anthropic/claude-sonnet-4-6', got '${judgeModel}'`,
    )
  }
  return judgeModel as LanguageModel
}
