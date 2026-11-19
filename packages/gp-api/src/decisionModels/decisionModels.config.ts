import { z } from 'zod'
import {
  DECISION_MODEL_PROVIDERS,
  type DecisionModelProviderName,
} from './schemas/decisionQuestions.schema'

// Read at call time, not import, so a deploy's env change takes effect
// without a code change and a test can stub it.

export const DECISION_TIMEOUT_MS = 15_000

export const GEMINI_DECISION_DEFAULT_MODEL = 'gemini-decision-1'
export const TYPESAFE_DEFAULT_MODEL = 'jev-latest'

const DEFAULT_MODEL: Record<DecisionModelProviderName, string> = {
  gemini: GEMINI_DECISION_DEFAULT_MODEL,
  typesafe: TYPESAFE_DEFAULT_MODEL,
}

// USD per million input tokens, by the model id the provider reports. A
// model missing here prices as null rather than as a guess.
export const DECISION_MODEL_INPUT_USD_PER_MILLION_TOKENS: Record<
  string,
  number
> = {
  [GEMINI_DECISION_DEFAULT_MODEL]: 0.1,
}

// Unset means Gemini. Any other value that is not a provider name throws:
// a typo must not quietly send text to a vendor nobody chose.
export const decisionModelProvider = (): DecisionModelProviderName => {
  const configured = process.env.DECISION_MODEL_PROVIDER?.trim()
  return configured
    ? z.enum(DECISION_MODEL_PROVIDERS).parse(configured)
    : 'gemini'
}

export const decisionModelId = (provider: DecisionModelProviderName): string =>
  process.env.DECISION_MODEL_ID?.trim() || DEFAULT_MODEL[provider]

export const decisionModelApiKey = (
  provider: DecisionModelProviderName,
): string | undefined =>
  provider === 'gemini'
    ? process.env.GEMINI_API_KEY
    : process.env.TYPESAFE_API_KEY

export const decisionCostUsd = (
  model: string,
  inputTokens: number,
): number | null => {
  const perMillion = DECISION_MODEL_INPUT_USD_PER_MILLION_TOKENS[model]
  return perMillion === undefined
    ? null
    : (inputTokens / 1_000_000) * perMillion
}
