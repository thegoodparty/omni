import {
  generateObject,
  type FlexibleSchema,
  type InferSchema,
  type LanguageModel,
} from 'ai'
import { resolveJudgeModel } from './model'

// Every suite kind that needs a model goes through here, so the provider
// options below are written once. `generateObject` with a schema, never a
// provider SDK, and JUDGE_MODEL is the only thing naming a provider.
export const JUDGE_MODEL_VARIABLE = 'JUDGE_MODEL'

// A generateObject call as this module makes it: one schema, one prompt, one
// parsed object. Its own shape rather than `grade.ts`'s, whose `z.ZodType`
// does not cover a schema reached through the AI SDK's own types.
export type JudgeGenerateObjectFn = (options: {
  model: LanguageModel
  schema: FlexibleSchema
  prompt: string
}) => Promise<{ object: unknown; usage: unknown }>

// One generateObject call, returning what the schema parsed.
export type JudgeModel = <Schema extends FlexibleSchema>(
  schema: Schema,
  prompt: string,
) => Promise<InferSchema<Schema>>

export type JudgeModelOptions = {
  // A test's stand-in for the provider.
  generateObjectFn?: JudgeGenerateObjectFn
  env?: NodeJS.ProcessEnv
  resolveModel?: (judgeModel: string) => LanguageModel
}

// Exported so a test can drive it with a mock model and read what it sent.
export const generateObjectStructured: JudgeGenerateObjectFn = async ({
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

// The model is resolved when a call is made, never at import: a suite whose
// judge never calls it runs with no JUDGE_MODEL and no provider key.
export const createJudgeModel = ({
  generateObjectFn = generateObjectStructured,
  env = process.env,
  resolveModel = resolveJudgeModel,
}: JudgeModelOptions = {}): JudgeModel => {
  const judgeModel: JudgeModel = async (schema, prompt) => {
    const judgeModelName = env[JUDGE_MODEL_VARIABLE]
    if (!judgeModelName) {
      throw new Error(
        `JUDGE_MODEL is not set, and this case's judge calls the model. ` +
          `Set it to an AI SDK model id such as anthropic/claude-sonnet-5-5, ` +
          `and put that provider's own key in its environment variable ` +
          `(ANTHROPIC_API_KEY for anthropic).`,
      )
    }
    const { object } = await generateObjectFn({
      model: resolveModel(judgeModelName),
      schema,
      prompt,
    })
    return object as InferSchema<typeof schema>
  }
  return judgeModel
}
