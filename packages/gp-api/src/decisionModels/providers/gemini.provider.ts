import { HttpStatus } from '@nestjs/common'
import { Headers, Methods, MimeTypes } from 'http-constants-ts'
import { DECISION_TIMEOUT_MS } from '../decisionModels.config'
import { DecisionModelError } from '../decisionModel.error'
import type {
  DecisionQuestions,
  ProviderDecision,
} from '../schemas/decisionQuestions.schema'
import {
  GEMINI_API_KEY_INVALID_REASON,
  GeminiDecisionsResponseSchema,
  GeminiErrorResponseSchema,
} from '../schemas/decisionWire.schema'
import { fromWireAnswers, toWireQuestions } from './wireFormat'

// Plain HTTP: @google/genai 2.10.0 has no decisions surface.
export const GEMINI_DECISIONS_URL =
  'https://generativelanguage.googleapis.com/v1beta/decisions'

export const geminiDecide = async (params: {
  input: string
  questions: DecisionQuestions
  model: string
  apiKey: string
}): Promise<ProviderDecision> => {
  const { input, questions, model, apiKey } = params
  let response: Response
  try {
    response = await fetch(GEMINI_DECISIONS_URL, {
      method: Methods.POST,
      headers: {
        [Headers.CONTENT_TYPE]: MimeTypes.APPLICATION_JSON,
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        model,
        input,
        questions: toWireQuestions(questions),
      }),
      signal: AbortSignal.timeout(DECISION_TIMEOUT_MS),
    })
  } catch (error) {
    throw new DecisionModelError(
      'provider_error',
      'gemini',
      {},
      error instanceof Error ? error : undefined,
    )
  }

  if (!response.ok) {
    const failure = GeminiErrorResponseSchema.safeParse(
      await response.json().catch(() => null),
    )
    const error = failure.success ? failure.data.error : undefined
    const reasons = (error?.details ?? []).map((detail) => detail.reason)
    const unauthorized =
      response.status === Number(HttpStatus.UNAUTHORIZED) ||
      response.status === Number(HttpStatus.FORBIDDEN) ||
      reasons.includes(GEMINI_API_KEY_INVALID_REASON)
    throw new DecisionModelError(
      unauthorized
        ? 'unauthorized'
        : response.status === Number(HttpStatus.BAD_REQUEST)
          ? 'input_rejected'
          : 'provider_error',
      'gemini',
      {
        httpStatus: response.status,
        providerStatus: reasons.find(Boolean) ?? error?.status,
      },
    )
  }

  const parsed = GeminiDecisionsResponseSchema.safeParse(
    await response.json().catch(() => null),
  )
  if (!parsed.success) {
    throw new DecisionModelError('invalid_response', 'gemini')
  }
  const blockReason = parsed.data.prompt_feedback?.block_reason
  if (blockReason) {
    throw new DecisionModelError('safety_block', 'gemini', { blockReason })
  }
  if (!parsed.data.usage) {
    throw new DecisionModelError('invalid_response', 'gemini')
  }
  return {
    answers: fromWireAnswers('gemini', questions, parsed.data.answers),
    usage: { inputTokens: parsed.data.usage.total_input_tokens },
    model,
  }
}
