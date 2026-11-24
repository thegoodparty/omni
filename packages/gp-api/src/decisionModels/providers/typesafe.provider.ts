import { HttpStatus } from '@nestjs/common'
import { Headers, Methods, MimeTypes } from 'http-constants-ts'
import { DECISION_TIMEOUT_MS } from '../decisionModels.config'
import { DecisionModelError } from '../decisionModel.error'
import type {
  DecisionQuestions,
  ProviderDecision,
} from '../schemas/decisionQuestions.schema'
import { TypesafeSystemOneResponseSchema } from '../schemas/decisionWire.schema'
import { fromWireAnswers, toWireQuestions } from './wireFormat'

// TypeSafe's System One models (Jev), called directly.
export const TYPESAFE_SYSTEM_ONE_URL = 'https://api.typesafe.ai/v1/systemone'

export const typesafeDecide = async (params: {
  input: string
  questions: DecisionQuestions
  model: string
  apiKey: string
}): Promise<ProviderDecision> => {
  const { input, questions, model, apiKey } = params
  let response: Response
  try {
    response = await fetch(TYPESAFE_SYSTEM_ONE_URL, {
      method: Methods.POST,
      headers: {
        [Headers.CONTENT_TYPE]: MimeTypes.APPLICATION_JSON,
        [Headers.AUTHORIZATION]: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        state: input,
        questions: toWireQuestions(questions),
      }),
      signal: AbortSignal.timeout(DECISION_TIMEOUT_MS),
    })
  } catch (error) {
    throw new DecisionModelError(
      'provider_error',
      'typesafe',
      {},
      error instanceof Error ? error : undefined,
    )
  }

  if (!response.ok) {
    throw new DecisionModelError(
      response.status === Number(HttpStatus.UNAUTHORIZED) ||
        response.status === Number(HttpStatus.FORBIDDEN)
        ? 'unauthorized'
        : response.status === Number(HttpStatus.BAD_REQUEST)
          ? 'input_rejected'
          : 'provider_error',
      'typesafe',
      { httpStatus: response.status },
    )
  }

  const parsed = TypesafeSystemOneResponseSchema.safeParse(
    await response.json().catch(() => null),
  )
  if (!parsed.success) {
    throw new DecisionModelError('invalid_response', 'typesafe')
  }
  return {
    answers: fromWireAnswers('typesafe', questions, parsed.data.answers),
    usage: {
      inputTokens: parsed.data.usage.input_tokens,
      outputTokens: parsed.data.usage.output_tokens,
    },
    model: parsed.data.model,
  }
}
