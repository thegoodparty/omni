import { DecisionModelError } from '../decisionModel.error'
import type {
  DecisionAnswer,
  DecisionModelProviderName,
  DecisionQuestion,
  DecisionQuestions,
} from '../schemas/decisionQuestions.schema'
import type { WireAnswer, WireQuestion } from '../schemas/decisionWire.schema'

const YES_THRESHOLD = 0.5

const toWireQuestion = (question: DecisionQuestion): WireQuestion => {
  switch (question.type) {
    case 'yesNo': {
      const criteria = {
        ...(question.trueDescription && {
          true_description: question.trueDescription,
        }),
        ...(question.falseDescription && {
          false_description: question.falseDescription,
        }),
      }
      return {
        type: 'noul',
        instructions: question.instructions,
        ...(Object.keys(criteria).length > 0 && { criteria }),
      }
    }
    case 'choice':
      return {
        type: 'choice',
        instructions: question.instructions,
        criteria: question.options,
      }
    case 'score':
      return {
        type: 'score',
        instructions: question.instructions,
        criteria: question.levels,
      }
  }
}

export const toWireQuestions = (
  questions: DecisionQuestions,
): Record<string, WireQuestion> =>
  Object.fromEntries(
    Object.entries(questions).map(([key, question]) => [
      key,
      toWireQuestion(question),
    ]),
  )

const fromWireAnswer = (
  question: DecisionQuestion,
  answer: WireAnswer,
): DecisionAnswer | null => {
  if (question.type === 'yesNo' && answer.type === 'noul') {
    return {
      type: 'yesNo',
      value: answer.noul >= YES_THRESHOLD,
      probabilities: { true: answer.noul, false: 1 - answer.noul },
      ...(answer.confidence !== undefined && {
        confidence: answer.confidence,
      }),
    }
  }
  if (
    question.type === 'choice' &&
    answer.type === 'choice' &&
    answer.choice in question.options
  ) {
    return {
      type: 'choice',
      value: answer.choice,
      probabilities: answer.probabilities,
      ...(answer.confidence !== undefined && {
        confidence: answer.confidence,
      }),
    }
  }
  if (question.type === 'score' && answer.type === 'score') {
    return {
      type: 'score',
      value: answer.score,
      probabilities: answer.probabilities,
      ...(answer.confidence !== undefined && {
        confidence: answer.confidence,
      }),
    }
  }
  return null
}

// Every question asked must come back, as the type it was asked as. A
// missing or mistyped answer fails the whole call rather than handing the
// caller a partial map it would have to check key by key.
export const fromWireAnswers = (
  provider: DecisionModelProviderName,
  questions: DecisionQuestions,
  answers: Record<string, WireAnswer>,
): Record<string, DecisionAnswer> =>
  Object.fromEntries(
    Object.entries(questions).map(([key, question]) => {
      const wire = answers[key]
      const answer = wire ? fromWireAnswer(question, wire) : null
      if (!answer) throw new DecisionModelError('invalid_response', provider)
      return [key, answer]
    }),
  )
