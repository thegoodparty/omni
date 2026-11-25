import { generateObject, type LanguageModel } from 'ai'
import { z } from 'zod'

// One grading call, through the Vercel AI SDK: never a provider SDK, so
// JUDGE_MODEL is the only thing naming a provider.
//
// The judge is told about A and B and nothing else. It never learns which arm
// is the candidate, and it is asked for no overall preference: it reads one
// criterion at a time and says which output behaves better on that criterion,
// or that neither does. A pair can therefore report a regression and an
// improvement at once, when each is real. Orienting a slot onto an arm is this
// module's job, after the fact, with a blinding this module is never handed.

export const DEFAULT_DIMENSIONS: Record<string, string> = {
  task_success: 'How fully does this output accomplish what was asked?',
  instruction_adherence:
    'How well does this output follow the instructions it was given, including what it was told not to do?',
  user_utility:
    'How useful would this output be to the person who asked for it?',
}

export const HandledSchema = z.enum(['yes', 'partly', 'no'])
export type HandledValue = z.infer<typeof HandledSchema>

// The case's pass rule read as a criterion of its own. It is concrete and
// per-case, so it can confirm a change where a scored question alone cannot.
export const HANDLED_WHEN_CRITERION = 'handledWhen'

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

export type CriterionDirection = 'A' | 'B' | 'none'

// One criterion's reading, still in A/B.
export type SlotChange = {
  criterion: string
  // Which output behaves materially better on this criterion, if either.
  better: CriterionDirection
  // What each output did on it, in concrete terms.
  evidence: string
}

// What the model returns, still in A/B: the schema's own shape.
export type SlotVerdict = {
  reasoning: string
  changes: SlotChange[]
  handledWhen?: { A: HandledValue; B: HandledValue }
}

// The same reading with the pass rule absent rather than optional. Orienting it
// to arms is `orientOrder`'s job.
export type SlotReading = {
  reasoning: string
  changes: SlotChange[]
  handledWhen: { A: HandledValue; B: HandledValue } | null
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
    throw new Error('A grading call needs at least one criterion')
  }
  return z.object({
    reasoning: z
      .string()
      .min(1)
      .describe(
        'One sentence naming the observable behavior that decided this reading.',
      ),
    changes: z
      .array(
        z.object({
          criterion:
            names.length === 1
              ? z.enum([names[0]!])
              : z.enum(names as [string, ...string[]]),
          better: z
            .enum(['A', 'B', 'none'])
            .describe(
              'Which output behaves materially better on this criterion: ' +
                '"A", "B", or "none" when neither does.',
            ),
          evidence: z
            .string()
            .min(1)
            .describe(
              'What each output did on this criterion, in concrete terms.',
            ),
        }),
      )
      .describe('One entry per criterion, once each.'),
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
    `CRITERIA`,
    dimensions
      .map(
        (dimension, index) =>
          `${index + 1}. ${dimension.name}: ${dimension.question}`,
      )
      .join('\n'),
    `For each criterion, answer which output behaves materially better: "A", "B", or "none".`,
    `Only a concrete, observable difference in behavior counts: what the output states, includes, omits, gets wrong or does.`,
    `Ignore preferences about wording, style, tone, length and formatting unless the task or criterion explicitly requires them. Answer "none" unless a reader of both outputs could point at the same specific behavior and agree on which output did it better.`,
    `Name that behavior in evidence, for both outputs.`,
    `Say what the evidence supports in this pair; another attempt will test whether the same change recurs.`,
    ``,
    `OUTPUT A`,
    a,
    ``,
    `OUTPUT B`,
    b,
    ``,
    `Neither output is known to be the newer or the better build; which one is A is arbitrary.`,
    `Read each criterion on its own: an output can be better on one and worse on another.`,
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
    // Newer Claude models refuse the forced tool call @ai-sdk/anthropic falls
    // back to for a model id it does not know, so ask for native JSON output.
    providerOptions: { anthropic: { structuredOutputMode: 'outputFormat' } },
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
  generateObjectFn?: GenerateObjectFn
}

export const createGrader = ({
  model,
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

// The schema validates types; it cannot say every criterion was read, so that
// one invariant is checked here. `generateObject` has already applied the
// schema, and a test's fake is held to the same rule.
export const readSlotVerdict = (
  object: unknown,
  dimensions: Dimension[],
): SlotReading => {
  const parsed = object as SlotVerdict
  const wanted = new Set(dimensions.map((dimension) => dimension.name))
  const read = new Set(parsed.changes.map((change) => change.criterion))
  if (read.size !== parsed.changes.length) {
    throw new Error('Grading returned a criterion twice')
  }
  const unknown = [...read].filter((name) => !wanted.has(name))
  if (unknown.length > 0) {
    throw new Error(`Grading returned unknown criteria: ${unknown.join(', ')}`)
  }
  const missing = [...wanted].filter((name) => !read.has(name))
  if (missing.length > 0) {
    throw new Error(`Grading returned no reading for: ${missing.join(', ')}`)
  }
  return {
    reasoning: parsed.reasoning,
    changes: parsed.changes,
    handledWhen: parsed.handledWhen ?? null,
  }
}

// One pair: the same two outputs, judged in both orders. Two orders that read a
// criterion in opposite directions are not a reading of the output, so they
// confirm nothing — not a tie, and not a change.
export type PairRequest = {
  caseId: string
  attempt: number
  task: string
  grading: GradingQuestion
  dimensions: Dimension[]
  baseOutput: string
  candidateOutput: string
}

export type OrientedChange = {
  criterion: string
  better: 'base' | 'candidate' | 'none'
  evidence: string
}

export type OrientedOrder = {
  // Which arm was shown as A in this order.
  aArm: 'base' | 'candidate'
  changes: OrientedChange[]
  reasoning: string
  handled: { base: HandledValue; candidate: HandledValue } | null
  usage: TokenUsage
}

// A criterion both orders read as a material change in the same direction.
export type MaterialChange = {
  criterion: string
  // About the candidate, relative to the base.
  direction: 'better' | 'worse'
  // One line per grading order, saying what it saw.
  evidence: string[]
}

export type GradedPair = {
  caseId: string
  attempt: number
  // The changes both orders agreed on. Empty when every criterion read "none"
  // in both orders: an actual tie, not a disagreement.
  changes: MaterialChange[]
  // Criteria the orders read in opposite directions, or one order read a change
  // and the other read none. No reading here, so neither order confirms.
  disagreements: string[]
  orders: OrientedOrder[]
  usage: TokenUsage
}

export const orientOrder = (
  verdict: SlotReading,
  usage: TokenUsage,
  // True when the candidate was shown as A.
  candidateIsA: boolean,
): OrientedOrder => {
  const armOf = (slot: CriterionDirection): OrientedChange['better'] => {
    if (slot === 'none') return 'none'
    if (slot === 'A') return candidateIsA ? 'candidate' : 'base'
    return candidateIsA ? 'base' : 'candidate'
  }
  return {
    aArm: candidateIsA ? 'candidate' : 'base',
    changes: verdict.changes.map((change) => ({
      criterion: change.criterion,
      better: armOf(change.better),
      evidence: change.evidence,
    })),
    reasoning: verdict.reasoning,
    handled: verdict.handledWhen
      ? {
          base: candidateIsA ? verdict.handledWhen.B : verdict.handledWhen.A,
          candidate: candidateIsA
            ? verdict.handledWhen.A
            : verdict.handledWhen.B,
        }
      : null,
    usage,
  }
}

// Only a full pass meets the case's requirement; two failures do not make a
// pass-rule change even if one output got partway there.
export const handledDirection = (
  order: OrientedOrder,
): OrientedChange['better'] => {
  if (!order.handled) return 'none'
  const base = order.handled.base === 'yes'
  const candidate = order.handled.candidate === 'yes'
  if (base === candidate) return 'none'
  return candidate ? 'candidate' : 'base'
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

  const changes: MaterialChange[] = []
  const disagreements: string[] = []
  const agree = (
    criterion: string,
    directions: readonly OrientedChange['better'][],
    evidence: readonly string[],
  ) => {
    const [first, second] = directions
    if (first === 'none' && second === 'none') return
    if (first !== second) {
      disagreements.push(criterion)
      return
    }
    // One pair answers a criterion once, so a duplicate reading is dropped
    // rather than reported twice.
    if (changes.some((change) => change.criterion === criterion)) return
    changes.push({
      criterion,
      direction: first === 'candidate' ? 'better' : 'worse',
      evidence: [...evidence],
    })
  }

  // The pass rule reads first, so a case that happens to name a dimension
  // `handledWhen` cannot shadow it: one pair answers a criterion once, and the
  // concrete, per-case rule is the one that counts.
  const handledValues = orders
    .map((order) => order.handled)
    .filter(
      (handled): handled is { base: HandledValue; candidate: HandledValue } =>
        handled !== null,
    )

  const passRule = request.grading.handledWhen
  if (passRule && handledValues.length === orders.length)
    agree(
      HANDLED_WHEN_CRITERION,
      orders.map(handledDirection),
      orders.map((order) =>
        order.handled
          ? `Base: ${order.handled.base}; candidate: ${order.handled.candidate}. Rule: ${passRule}`
          : '',
      ),
    )

  for (const dimension of request.dimensions) {
    const readings = orders.map((order) =>
      order.changes.find((change) => change.criterion === dimension.name),
    )
    agree(
      dimension.name,
      readings.map((reading) => reading?.better ?? 'none'),
      readings.map((reading) => reading?.evidence ?? ''),
    )
  }

  return {
    caseId: request.caseId,
    attempt: request.attempt,
    changes,
    disagreements,
    orders,
    usage: orders.reduce(
      (total, order) => ({
        inputTokens: total.inputTokens + order.usage.inputTokens,
        outputTokens: total.outputTokens + order.usage.outputTokens,
      }),
      { inputTokens: 0, outputTokens: 0 },
    ),
  }
}
