import { BadGatewayException } from '@nestjs/common'
import type { DecisionModelProviderName } from './schemas/decisionQuestions.schema'

export type DecisionModelErrorReason =
  /** The provider's key is not set. */
  | 'not_configured'
  /** The provider refused the key: a 401, a 403, or Gemini's API_KEY_INVALID. */
  | 'unauthorized'
  /** The provider answered with a block reason instead of answers. */
  | 'safety_block'
  /** A 400: the provider refused the input. Safety blocks can arrive this way. */
  | 'input_rejected'
  /** Any other non-2xx, a network failure or a timeout. */
  | 'provider_error'
  /** A 2xx whose body failed validation or left a question unanswered. */
  | 'invalid_response'

// Carries status codes and provider error codes only. Provider messages are
// left out on purpose: one that quoted the input would put it in our logs.
export class DecisionModelError extends BadGatewayException {
  constructor(
    readonly reason: DecisionModelErrorReason,
    readonly provider: DecisionModelProviderName,
    readonly detail: {
      httpStatus?: number
      providerStatus?: string
      blockReason?: string
    } = {},
    cause?: Error,
  ) {
    super(`Decision model ${provider} failed: ${reason}`, { cause })
  }
}
