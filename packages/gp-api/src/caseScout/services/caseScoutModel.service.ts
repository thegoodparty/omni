import { Injectable } from '@nestjs/common'
import { createAnthropic } from '@ai-sdk/anthropic'
import {
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  type LanguageModel,
  type SystemModelMessage,
} from 'ai'
import {
  productMapReference,
  SCORING_MODEL,
  SECOND_READ_PROMPT,
  SCORING_PROMPT,
  secondReadMessage,
} from '../caseScout.prompts'
import {
  ScoreResponseSchema,
  type ScoreResponse,
} from '../schemas/caseScoutModel.schema'
import { SecondReadCallError } from '../util/gate.util'

const CALL_TIMEOUT_MS = 60_000
const SCORE_MAX_TOKENS = 4_096
const DRAFT_MAX_TOKENS = 2_048
const SECOND_READ_MAX_TOKENS = 512

// The reply could not be read as the scoring shape; worth one more call.
export class ScoreParseError extends Error {}

// Transcripts are in every prompt here, so spans carry neither inputs nor
// outputs.
const telemetry = (functionId: string) =>
  ({
    isEnabled: true,
    functionId,
    recordInputs: false,
    recordOutputs: false,
  }) as const

const withTimeout = (signal: AbortSignal): AbortSignal =>
  AbortSignal.any([signal, AbortSignal.timeout(CALL_TIMEOUT_MS)])

const cached = (content: string): SystemModelMessage => ({
  role: 'system',
  content,
  providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
})

// The scope's product map leads both the scoring and the drafting system
// prompt, so a night of calls in one scope reads it from the cache instead of
// paying for it each time. Everything after the first breakpoint that varies
// (the drafter's case list and proposals) comes after it.
export const scoringSystem = (scope: string): SystemModelMessage[] => [
  cached(productMapReference(scope)),
  cached(SCORING_PROMPT),
]

export const draftingSystem = (
  scope: string,
  instructions: string,
): SystemModelMessage[] => [
  cached(productMapReference(scope)),
  { role: 'system', content: instructions },
]

// The scout's three model calls. None of them is ever given a tool: the model
// reads untrusted chat text, so all it can do is return text that is then
// schema-checked and gated. One attempt each, with no SDK retries, as the
// Python reader made them; the callers own the retry rules.
@Injectable()
export class CaseScoutModelService {
  private model(): LanguageModel {
    return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(
      SCORING_MODEL,
    )
  }

  async scoreTranscript(
    scope: string,
    transcript: string,
    signal: AbortSignal,
  ): Promise<ScoreResponse> {
    try {
      const result = await generateText({
        model: this.model(),
        system: scoringSystem(scope),
        prompt: transcript,
        maxOutputTokens: SCORE_MAX_TOKENS,
        maxRetries: 0,
        abortSignal: withTimeout(signal),
        output: Output.object({ schema: ScoreResponseSchema }),
        // Never fall back to a JSON tool: the scoring call has no tools.
        providerOptions: {
          anthropic: { structuredOutputMode: 'outputFormat' },
        },
        experimental_telemetry: telemetry('caseScout.score'),
      })
      return result.output
    } catch (err) {
      if (
        NoObjectGeneratedError.isInstance(err) ||
        NoOutputGeneratedError.isInstance(err)
      ) {
        throw new ScoreParseError(err.message)
      }
      throw err
    }
  }

  async draftCase(
    scope: string,
    system: string,
    transcript: string,
    signal: AbortSignal,
  ): Promise<string> {
    const result = await generateText({
      model: this.model(),
      system: draftingSystem(scope, system),
      prompt: transcript,
      maxOutputTokens: DRAFT_MAX_TOKENS,
      maxRetries: 0,
      abortSignal: withTimeout(signal),
      experimental_telemetry: telemetry('caseScout.draft'),
    })
    return result.text
  }

  async secondRead(
    draftText: string,
    sourceText: string,
    signal: AbortSignal,
  ): Promise<string> {
    try {
      const result = await generateText({
        model: this.model(),
        system: SECOND_READ_PROMPT,
        prompt: secondReadMessage(draftText, sourceText),
        maxOutputTokens: SECOND_READ_MAX_TOKENS,
        maxRetries: 0,
        abortSignal: withTimeout(signal),
        experimental_telemetry: telemetry('caseScout.secondRead'),
      })
      return result.text
    } catch (err) {
      if (signal.aborted) throw err
      throw new SecondReadCallError(
        err instanceof Error ? err.message : 'second read call failed',
      )
    }
  }
}
