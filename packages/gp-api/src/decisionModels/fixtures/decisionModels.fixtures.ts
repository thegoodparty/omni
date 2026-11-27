import type { DecisionQuestions } from '../schemas/decisionQuestions.schema'

// Provider bodies for the decision model tests. Text is invented. The
// invalid-key error is recorded from the live Gemini API (2026-11-18); the
// success bodies follow each provider's documented shape, since no valid
// key was on hand to record them.

export const FICTIONAL_REPLY =
  'Thanks for the note about the new library hours, see you Saturday.'

export const QUESTIONS = {
  thanks: {
    type: 'yesNo',
    instructions: 'Is the person thanking the sender?',
    trueDescription: 'They thank the sender.',
    falseDescription: 'They do not thank the sender.',
  },
  bare: {
    type: 'yesNo',
    instructions: 'Does the person ask a question?',
  },
  topic: {
    type: 'choice',
    instructions: 'What is the reply mostly about?',
    options: {
      library: 'The library',
      roads: 'Roads',
      other: 'Something else',
    },
  },
  warmth: {
    type: 'score',
    instructions: 'How warm is the reply?',
    levels: ['cold', 'neutral', 'warm'],
  },
} satisfies DecisionQuestions

export const EXPECTED_WIRE_QUESTIONS = {
  thanks: {
    type: 'noul',
    instructions: 'Is the person thanking the sender?',
    criteria: {
      true_description: 'They thank the sender.',
      false_description: 'They do not thank the sender.',
    },
  },
  bare: {
    type: 'noul',
    instructions: 'Does the person ask a question?',
  },
  topic: {
    type: 'choice',
    instructions: 'What is the reply mostly about?',
    criteria: {
      library: 'The library',
      roads: 'Roads',
      other: 'Something else',
    },
  },
  warmth: {
    type: 'score',
    instructions: 'How warm is the reply?',
    criteria: ['cold', 'neutral', 'warm'],
  },
}

export const GEMINI_SUCCESS = {
  answers: {
    thanks: { type: 'noul', noul: 0.97, confidence: 0.9 },
    bare: { type: 'noul', noul: 0.04, confidence: 0.95 },
    topic: {
      type: 'choice',
      choice: 'library',
      probabilities: { library: 0.92, roads: 0.01, other: 0.07 },
      confidence: 0.88,
    },
    warmth: {
      type: 'score',
      score: 2,
      legend: 'warm',
      probabilities: { '0': 0.02, '1': 0.18, '2': 0.8 },
      confidence: 0.7,
    },
  },
  usage: { total_input_tokens: 412, total_output_tokens: 0 },
}

export const GEMINI_BLOCKED = {
  answers: {},
  prompt_feedback: { block_reason: 'SAFETY' },
  usage: { total_input_tokens: 40 },
}

export const GEMINI_SAFETY_400 = {
  error: {
    code: 400,
    message: 'The input was blocked.',
    status: 'INVALID_ARGUMENT',
  },
}

// Recorded.
export const GEMINI_INVALID_KEY_400 = {
  error: {
    code: 400,
    message: 'API key not valid. Please pass a valid API key.',
    status: 'INVALID_ARGUMENT',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
        reason: 'API_KEY_INVALID',
        domain: 'googleapis.com',
        metadata: { service: 'generativelanguage.googleapis.com' },
      },
      {
        '@type': 'type.googleapis.com/google.rpc.LocalizedMessage',
        locale: 'en-US',
        message: 'API key not valid. Please pass a valid API key.',
      },
    ],
  },
}

export const TYPESAFE_SUCCESS = {
  model: 'jev-1',
  answers: {
    thanks: { type: 'noul', noul: 0.95 },
    bare: { type: 'noul', noul: 0.1 },
    topic: {
      type: 'choice',
      choice: 'library',
      probabilities: { library: 0.9, roads: 0.02, other: 0.08 },
    },
    warmth: {
      type: 'score',
      score: 2,
      probabilities: { '0': 0.05, '1': 0.25, '2': 0.7 },
    },
  },
  usage: { input_tokens: 380, output_tokens: 12 },
}
