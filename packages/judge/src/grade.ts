import { generateObject, type LanguageModel } from 'ai'
import { z } from 'zod'

// One grading call, through the Vercel AI SDK: never a provider SDK, so
// `--judge-model` is the only thing naming a provider.
//
// The judge is told about A and B and nothing else. It never learns which arm
// is the candidate, and its vocabulary has no BETTER or WORSE in it — only a
// slot, a tie, or an admission that it cannot tell. Turning a slot into a
// direction is scoring's job, after the fact, with an orientation this module
// is never handed.

export const DEFAULT_DIMENSIONS: Record<string, string> = {
  task_success: 'How fully does this output accomplish what was asked?',
  instruction_adherence:
    'How well does this output follow the instructions it was given, including what it was told not to do?',
  user_utility:
    'How useful would this output be to the person who asked for it?',
}

export const HandledSchema = z.enum(['yes', 'partly', 'no'])
export type HandledValue = z.infer<typeof HandledSchema>

export type Dimension = { name: string; question: string }

export type GradingQuestion = {
  // What is special about this case.
  condition?: string
  // A pass/fail rule checked on each run, as a sentence.
  handledWhen?: string
  dimensions?: Record<string, string>
}

export type OrderRequest = {
  caseId: string
  task: string
  grading: GradingQuestion
  dimensions: Dimension[]
  // The two outputs, already in the order this call presents them. The caller
  // decides which arm is A.
  a: string
  b: string
}

// What the model returns, still in A/B: the schema's own shape.
export type SlotVerdict = {
  winner: 'A' | 'B' | 'tie'
  reasoning: string
  handledWhen?: { A: HandledValue; B: HandledValue }
  dimensions: { name: string; A: number; B: number }[]
}

// The same reading with the scores keyed by question, which is what the rest of
// the module works in. Orienting it to arms is `orientOrder`'s job.
export type SlotReading = {
  winner: 'A' | 'B' | 'tie'
  reasoning: string
  handledWhen: { A: HandledValue; B: HandledValue } | null
  scores: Record<string, { A: number; B: number }>
}

export type TokenUsage = {
  inputTokens: number
  outputTokens: number
}

export type GradedOrder = {
  verdict: SlotReading
  usage: TokenUsage
}

export const gradingSchema = (
  dimensions: Dimension[],
  hasHandledWhen: boolean,
) => {
  const names = dimensions.map((dimension) => dimension.name)
  if (names.length === 0) {
    throw new Error('A grading call needs at least one dimension')
  }
  return z.object({
    winner: z
      .enum(['A', 'B', 'tie'])
      .describe(
        'Which output better serves the person who asked. "tie" when neither ' +
          'is better, or when the difference is not one a reader of both would agree on.',
      ),
    reasoning: z
      .string()
      .min(1)
      .describe('One sentence saying why, naming what decided it.'),
    ...(hasHandledWhen
      ? {
          handledWhen: z
            .object({ A: HandledSchema, B: HandledSchema })
            .describe(
              'For each output, whether it does what the pass rule describes: ' +
                '"yes" fully, "partly" only in part, "no" not at all.',
            ),
        }
      : {}),
    dimensions: z
      .array(
        z.object({
          name:
            names.length === 1
              ? z.enum([names[0]!])
              : z.enum(names as [string, ...string[]]),
          A: z.number().int().min(1).max(5),
          B: z.number().int().min(1).max(5),
        }),
      )
      .describe(
        'One entry per question, scored 1 (poor) to 5 (excellent) for each output.',
      ),
  })
}

export const buildGradingPrompt = (request: OrderRequest): string => {
  const { task, grading, dimensions, a, b } = request
  const parts = [
    `You are comparing two outputs (A and B) produced by two builds of the same agent for one task.`,
    ``,
    `TASK`,
    task,
  ]
  if (grading.condition) {
    parts.push(``, `WHAT THIS CASE IS TESTING`, grading.condition)
  }
  if (grading.handledWhen) {
    parts.push(
      ``,
      `PASS RULE`,
      grading.handledWhen,
      `Answer handledWhen for each output by that rule.`,
    )
  }
  parts.push(
    ``,
    `QUESTIONS`,
    dimensions
      .map(
        (dimension, index) =>
          `${index + 1}. ${dimension.name}: ${dimension.question}`,
      )
      .join('\n'),
    `Score each question 1 to 5 for A and for B. The score is absolute, not a comparison:`,
    `a 5 is an excellent answer to that question and a 1 is a poor one, whichever is better.`,
    ``,
    `OUTPUT A`,
    a,
    ``,
    `OUTPUT B`,
    b,
    ``,
    `Neither output is known to be the newer or the better build; which one is A is arbitrary.`,
    `Pick the winner on the outputs alone. Say "tie" rather than inventing a difference.`,
  )
  return parts.join('\n')
}

// A generateObject-shaped function, so a test supplies its own.
export type GenerateObjectFn = (options: {
  model: LanguageModel
  schema: z.ZodType
  prompt: string
}) => Promise<{ object: unknown; usage: TokenUsage }>

const defaultGenerateObject: GenerateObjectFn = async ({
  model,
  schema,
  prompt,
}) => {
  const result = await generateObject({
    model,
    schema,
    prompt,
  })
  return {
    object: result.object,
    usage: {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    },
  }
}

export type Grader = {
  gradeOrder: (request: OrderRequest) => Promise<GradedOrder>
  gradePair: (request: PairRequest) => Promise<GradedPair>
}

export type GraderOptions = {
  model: LanguageModel
  dimensions?: Dimension[]
  generateObjectFn?: GenerateObjectFn
}

export const createGrader = ({
  model,
  dimensions = Object.entries(DEFAULT_DIMENSIONS).map(([name, question]) => ({
    name,
    question,
  })),
  generateObjectFn = defaultGenerateObject,
}: GraderOptions): Grader => {
  const gradeOrder = async (request: OrderRequest): Promise<GradedOrder> => {
    const schema = gradingSchema(
      request.dimensions,
      !!request.grading.handledWhen,
    )
    const { object, usage } = await generateObjectFn({
      model,
      schema,
      prompt: buildGradingPrompt(request),
    })
    return { verdict: readSlotVerdict(object, request.dimensions), usage }
  }

  return {
    gradeOrder,
    gradePair: (request) => gradePair(request, gradeOrder),
  }
}

// The schema validates types; it cannot say every dimension was answered, so
// that one invariant is checked here. `generateObject` has already applied the
// schema, and a test's fake is held to the same rule.
export const readSlotVerdict = (
  object: unknown,
  dimensions: Dimension[],
): SlotReading => {
  const parsed = object as SlotVerdict
  const wanted = new Set(dimensions.map((dimension) => dimension.name))
  const scored = new Set(parsed.dimensions.map((entry) => entry.name))
  if (scored.size !== parsed.dimensions.length) {
    throw new Error('Grading returned a dimension twice')
  }
  const unknown = [...scored].filter((name) => !wanted.has(name))
  if (unknown.length > 0) {
    throw new Error(
      `Grading returned unknown dimensions: ${unknown.join(', ')}`,
    )
  }
  const missing = [...wanted].filter((name) => !scored.has(name))
  if (missing.length > 0) {
    throw new Error(`Grading returned no scores for: ${missing.join(', ')}`)
  }
  return {
    winner: parsed.winner,
    reasoning: parsed.reasoning,
    handledWhen: parsed.handledWhen ?? null,
    scores: Object.fromEntries(
      parsed.dimensions.map((entry) => [
        entry.name,
        { A: entry.A, B: entry.B },
      ]),
    ),
  }
}

// One pair: the same two outputs, judged in both orders. Two orders that
// disagree are a tie — a reading that moves with the slot is not a reading of
// the output.
export type PairRequest = {
  caseId: string
  attempt: number
  task: string
  grading: GradingQuestion
  dimensions: Dimension[]
  baseOutput: string
  candidateOutput: string
}

export type OrientedOrder = {
  // Which arm was shown as A in this order.
  aArm: 'base' | 'candidate'
  winner: 'base' | 'candidate' | 'tie'
  reasoning: string
  handled: { base: HandledValue; candidate: HandledValue } | null
  scores: Record<string, { base: number; candidate: number }>
  usage: TokenUsage
}

export type GradedPair = {
  caseId: string
  attempt: number
  // The pair's direction: a tie covers both an honest tie and a disagreement.
  winner: 'base' | 'candidate' | 'tie'
  orders: OrientedOrder[]
  // Handled only when every order said yes: `partly` is not handled, and two
  // orders that disagree are not a reading of the run.
  handled: { base: boolean; candidate: boolean } | null
  // Each dimension's score, averaged over the orders that returned one.
  scores: Record<string, { base: number; candidate: number }>
  usage: TokenUsage
}

export const orientOrder = (
  verdict: SlotReading,
  usage: TokenUsage,
  // True when the candidate was shown as A.
  candidateIsA: boolean,
): OrientedOrder => {
  const armOf = (slot: 'A' | 'B'): 'base' | 'candidate' => {
    if (slot === 'A') return candidateIsA ? 'candidate' : 'base'
    return candidateIsA ? 'base' : 'candidate'
  }
  const winner = verdict.winner === 'tie' ? 'tie' : armOf(verdict.winner)
  const scores: OrientedOrder['scores'] = {}
  for (const [name, pair] of Object.entries(verdict.scores)) {
    scores[name] = {
      base: candidateIsA ? pair.B : pair.A,
      candidate: candidateIsA ? pair.A : pair.B,
    }
  }
  return {
    aArm: candidateIsA ? 'candidate' : 'base',
    winner,
    reasoning: verdict.reasoning,
    handled: verdict.handledWhen
      ? {
          base: candidateIsA ? verdict.handledWhen.B : verdict.handledWhen.A,
          candidate: candidateIsA
            ? verdict.handledWhen.A
            : verdict.handledWhen.B,
        }
      : null,
    scores,
    usage,
  }
}

export const gradePair = async (
  request: PairRequest,
  gradeOrder: (request: OrderRequest) => Promise<GradedOrder>,
): Promise<GradedPair> => {
  const shared = {
    caseId: request.caseId,
    task: request.task,
    grading: request.grading,
    dimensions: request.dimensions,
  }
  const baseFirst = await gradeOrder({
    ...shared,
    a: request.baseOutput,
    b: request.candidateOutput,
  })
  const candidateFirst = await gradeOrder({
    ...shared,
    a: request.candidateOutput,
    b: request.baseOutput,
  })
  const orders = [
    orientOrder(baseFirst.verdict, baseFirst.usage, false),
    orientOrder(candidateFirst.verdict, candidateFirst.usage, true),
  ]

  const winner: GradedPair['winner'] =
    orders[0]!.winner === orders[1]!.winner ? orders[0]!.winner : 'tie'

  const handledValues = orders
    .map((order) => order.handled)
    .filter(
      (handled): handled is { base: HandledValue; candidate: HandledValue } =>
        handled !== null,
    )
  const handled =
    handledValues.length === orders.length
      ? {
          base: handledValues.every((value) => value.base === 'yes'),
          candidate: handledValues.every((value) => value.candidate === 'yes'),
        }
      : null

  const scores: GradedPair['scores'] = {}
  for (const dimension of request.dimensions) {
    const baseScores = orders
      .map((order) => order.scores[dimension.name]?.base)
      .filter((score): score is number => typeof score === 'number')
    const candidateScores = orders
      .map((order) => order.scores[dimension.name]?.candidate)
      .filter((score): score is number => typeof score === 'number')
    if (baseScores.length > 0 && candidateScores.length > 0) {
      scores[dimension.name] = {
        base: mean(baseScores),
        candidate: mean(candidateScores),
      }
    }
  }

  return {
    caseId: request.caseId,
    attempt: request.attempt,
    winner,
    orders,
    handled,
    scores,
    usage: orders.reduce(
      (total, order) => ({
        inputTokens: total.inputTokens + order.usage.inputTokens,
        outputTokens: total.outputTokens + order.usage.outputTokens,
      }),
      { inputTokens: 0, outputTokens: 0 },
    ),
  }
}

export const mean = (values: readonly number[]): number =>
  values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length
