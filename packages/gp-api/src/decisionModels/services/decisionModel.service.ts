import { Injectable } from '@nestjs/common'
import {
  decisionCostUsd,
  decisionModelApiKey,
  decisionModelId,
  decisionModelProvider,
} from '../decisionModels.config'
import { DecisionModelError } from '../decisionModel.error'
import { geminiDecide } from '../providers/gemini.provider'
import { typesafeDecide } from '../providers/typesafe.provider'
import {
  type DecisionAnswers,
  type DecisionModelProviderName,
  type DecisionQuestions,
  DecisionQuestionsSchema,
  type DecisionRequest,
  type DecisionResult,
} from '../schemas/decisionQuestions.schema'

/**
 * Typed judgments over a piece of text: yes/no, choice and score questions,
 * each answered with probabilities. The provider is env config
 * (DECISION_MODEL_PROVIDER), so a product caller never names one. Failures
 * throw DecisionModelError; see src/decisionModels/AGENTS.md.
 */
@Injectable()
export class DecisionModelService {
  /**
   * `credentials` pins the provider and key for a caller that holds its own,
   * such as a judge arm whose test env stubs GEMINI_API_KEY. Product code
   * leaves it out and follows the env.
   */
  async decide<Q extends DecisionQuestions>(
    request: DecisionRequest<Q>,
    credentials?: { provider: DecisionModelProviderName; apiKey: string },
  ): Promise<DecisionResult<Q>> {
    const questions = DecisionQuestionsSchema.parse(request.questions)
    const provider = credentials?.provider ?? decisionModelProvider()
    const apiKey = credentials
      ? credentials.apiKey
      : decisionModelApiKey(provider)
    if (!apiKey) throw new DecisionModelError('not_configured', provider)

    const call = provider === 'gemini' ? geminiDecide : typesafeDecide
    const decision = await call({
      input: request.input,
      questions,
      model: decisionModelId(provider),
      apiKey,
    })
    return {
      // fromWireAnswers has checked every asked key came back as its type.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      answers: decision.answers as DecisionAnswers<Q>,
      usage: decision.usage,
      model: decision.model,
      provider,
      costUsd: decisionCostUsd(decision.model, decision.usage.inputTokens),
    }
  }
}
