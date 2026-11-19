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
  type DecisionQuestions,
  DecisionQuestionsSchema,
  type DecisionRequest,
  type DecisionResult,
} from '../schemas/decisionQuestions.schema'

/**
 * Typed judgments over a piece of text: yes/no, choice and score questions,
 * each answered with probabilities. The provider is env config
 * (DECISION_MODEL_PROVIDER), so a caller never names one. Failures throw
 * DecisionModelError; see src/decisionModels/AGENTS.md.
 */
@Injectable()
export class DecisionModelService {
  async decide<Q extends DecisionQuestions>(
    request: DecisionRequest<Q>,
  ): Promise<DecisionResult<Q>> {
    const questions = DecisionQuestionsSchema.parse(request.questions)
    const provider = decisionModelProvider()
    const apiKey = decisionModelApiKey(provider)
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
