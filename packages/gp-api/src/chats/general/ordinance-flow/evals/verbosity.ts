// Deterministic reading-load measurement for a step's opening turn: the
// framing prose the user reads in chat plus the widget payload text the UI
// renders. Advisory-first — budgets become gates only once baselines and
// product targets agree (see the verbosity report in the step evals).

const textFromPayload = (payload: unknown): string => {
  if (payload === null || payload === undefined) return ''
  if (typeof payload === 'string') return payload
  if (typeof payload === 'number' || typeof payload === 'boolean') return ''
  if (Array.isArray(payload)) return payload.map(textFromPayload).join(' ')
  if (typeof payload === 'object') {
    return Object.values(payload).map(textFromPayload).join(' ')
  }
  return ''
}

const countWords = (text: string): number =>
  text.split(/\s+/).filter((w) => w.length > 0).length

export interface StepVerbosity {
  proseWords: number
  payloadWords: number
  totalWords: number
}

// Measures only human-readable string values — keys, numbers, and structure
// don't count toward what a user reads.
export const measureStepVerbosity = (input: {
  assistantText: string
  payloads: unknown[]
}): StepVerbosity => {
  const proseWords = countWords(input.assistantText)
  const payloadWords = countWords(input.payloads.map(textFromPayload).join(' '))
  return {
    proseWords,
    payloadWords,
    totalWords: proseWords + payloadWords,
  }
}
