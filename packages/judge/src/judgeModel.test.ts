import { MockLanguageModelV3 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createJudgeModel,
  generateObjectStructured,
  JUDGE_MODEL_VARIABLE,
} from './judgeModel'

// `generateObject` asks for native JSON output, so the mock answers with a
// JSON object in a text part.
const jsonModel = (json: string) =>
  new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text: json }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 2, text: 2, reasoning: 0 },
      },
      warnings: [],
    }),
  })

const usage = { inputTokens: 1, outputTokens: 1 }

describe('createJudgeModel', () => {
  it('makes one generateObject call with the judge model, schema and prompt', async () => {
    const calls: { model: unknown; prompt: string }[] = []
    const judgeModel = createJudgeModel({
      env: { [JUDGE_MODEL_VARIABLE]: 'anthropic/claude-sonnet-5-5' },
      resolveModel: (name) => `resolved:${name}`,
      generateObjectFn: async ({ model, prompt }) => {
        calls.push({ model, prompt })
        return { object: { answer: 'yes' }, usage }
      },
    })
    const answer = await judgeModel(z.object({ answer: z.string() }), 'Clean?')
    expect(answer).toEqual({ answer: 'yes' })
    expect(calls).toEqual([
      { model: 'resolved:anthropic/claude-sonnet-5-5', prompt: 'Clean?' },
    ])
  })

  it('fails with a sentence naming JUDGE_MODEL when it is unset', async () => {
    const judgeModel = createJudgeModel({
      env: {},
      generateObjectFn: async () => ({ object: {}, usage }),
    })
    await expect(judgeModel(z.object({}), 'prompt')).rejects.toThrow(
      /JUDGE_MODEL is not set.*anthropic\/claude-sonnet-5-5/s,
    )
  })

  it('asks for native JSON output, which a model id the SDK does not know requires', async () => {
    const model = jsonModel('{"answer":"yes"}')
    const answers = await generateObjectStructured({
      model,
      schema: z.object({ answer: z.string() }),
      prompt: 'Clean?',
    })
    expect(answers.object).toEqual({ answer: 'yes' })
    expect(answers.usage).toEqual({ inputTokens: 3, outputTokens: 2 })
    expect(model.doGenerateCalls[0]!.responseFormat).toMatchObject({
      type: 'json',
    })
  })
})
