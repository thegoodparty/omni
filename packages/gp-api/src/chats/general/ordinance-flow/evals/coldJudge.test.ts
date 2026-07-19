import { Test } from '@nestjs/testing'
import { describe, expect, it } from 'vitest'
import { PinoLogger } from 'nestjs-pino'
import {
  GENERATE_OBJECT_TOKEN,
  LlmService,
} from '../../../../llm/services/llm.service'
import { coldJudge, judgePanel, type JudgeVerdict } from './coldJudge'

// Unit test (runs in CI, no real LLM): a fake generateObject is injected via
// the LlmService DI token GENERATE_OBJECT_TOKEN so the real jsonCompletion
// path runs, but returns canned verdicts. Asserts judgePanel aggregates the
// gate (agree / majorityPass) correctly. Order-independent: assertions read
// the multiset of verdicts, since Promise.all offers no ordering guarantee.

const noop = () => undefined
const noopLogger = {
  setContext: noop,
  info: noop,
  warn: noop,
  error: noop,
  debug: noop,
  trace: noop,
  fatal: noop,
}

const pass = (score: JudgeVerdict['score']): JudgeVerdict => ({
  pass: true,
  score,
  reasoning: 'satisfies the dimension',
})

const fail = (score: JudgeVerdict['score']): JudgeVerdict => ({
  pass: false,
  score,
  reasoning: 'invented a citation',
})

// One generateObject call per coldJudge call; return the queued verdicts in
// order, so a panel of N gets exactly the N verdicts supplied.
const buildJudge = async (verdicts: JudgeVerdict[]): Promise<LlmService> => {
  let call = 0
  const fakeGenerateObject = async () => {
    const object = verdicts[call]
    call += 1
    if (!object) {
      throw new Error('fake generateObject ran out of queued verdicts')
    }
    return { object, usage: { totalTokens: 7 } }
  }
  const moduleRef = await Test.createTestingModule({
    providers: [
      LlmService,
      { provide: PinoLogger, useValue: noopLogger },
      { provide: GENERATE_OBJECT_TOKEN, useValue: fakeGenerateObject },
    ],
  }).compile()
  return moduleRef.get(LlmService)
}

const INPUT = { rubric: 'the rubric', artifact: 'the artifact', dimension: 'd' }

describe('coldJudge', () => {
  it('returns the structured verdict from jsonCompletion', async () => {
    const llm = await buildJudge([pass(4)])

    const verdict = await coldJudge(llm, INPUT)

    expect(verdict).toEqual({
      pass: true,
      score: 4,
      reasoning: 'satisfies the dimension',
    })
  })
})

describe('judgePanel', () => {
  it('runs two judges by default', async () => {
    const llm = await buildJudge([pass(5), pass(4)])

    const result = await judgePanel(llm, INPUT)

    expect(result.verdicts).toHaveLength(2)
  })

  it('agrees and passes when every judge passes', async () => {
    const llm = await buildJudge([pass(5), pass(4)])

    const result = await judgePanel(llm, INPUT)

    expect(result.agree).toBe(true)
    expect(result.majorityPass).toBe(true)
  })

  it('agrees and fails when every judge fails', async () => {
    const llm = await buildJudge([fail(2), fail(1)])

    const result = await judgePanel(llm, INPUT)

    expect(result.agree).toBe(true)
    expect(result.majorityPass).toBe(false)
  })

  it('flags disagreement on a split gate and denies majority', async () => {
    const llm = await buildJudge([pass(4), fail(2)])

    const result = await judgePanel(llm, INPUT)

    expect(result.agree).toBe(false)
    expect(result.majorityPass).toBe(false)
  })

  it('grants majority but flags disagreement on a 2-of-3 split', async () => {
    const llm = await buildJudge([pass(5), pass(4), fail(2)])

    const result = await judgePanel(llm, INPUT, ['m1', 'm2', 'm3'])

    expect(result.verdicts).toHaveLength(3)
    expect(result.majorityPass).toBe(true)
    expect(result.agree).toBe(false)
  })
})
