import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { JsonJudgeModel } from '../../general/ordinance-flow/evals/coldJudge'
import { CaseDimensionSchema, MAX_CASE_DIMENSIONS } from './cases'
import { DEFAULT_JUDGE_CONFIG } from './config'
import {
  exitCodeOf,
  main,
  preflightCaseDimensions,
  preflightDimensions,
  preflightPayload,
  preflightSchema,
  refusalClass,
  runPreflight,
  UNEXPECTED_FAILURE,
} from './schemaPreflight'
import { cannedJudge } from './sweep'

// The check is only worth its call if the schema it sends is the largest the
// judge can send: a dropped case dimension or a missing handled field would
// let a schema the API refuses pass the preflight and fail the next sweep.
describe('the preflight schema is the largest the judge sends', () => {
  it('carries every default dimension and the most case dimensions', () => {
    const names = preflightDimensions()
    expect(names).toEqual([
      ...DEFAULT_JUDGE_CONFIG.dimensions,
      ...preflightCaseDimensions().map((d) => d.name),
    ])
    expect(preflightCaseDimensions()).toHaveLength(MAX_CASE_DIMENSIONS)
  })

  it('uses case dimensions a case list would accept', () => {
    for (const dimension of preflightCaseDimensions()) {
      expect(CaseDimensionSchema.safeParse(dimension).success).toBe(true)
    }
  })

  // At the longest a case list accepts, so one character more is refused:
  // a name is a schema key, so a shorter one understates the grammar.
  it('uses the longest name and question a case list accepts', () => {
    for (const dimension of preflightCaseDimensions()) {
      for (const longer of [
        { ...dimension, name: `${dimension.name}x` },
        { ...dimension, question: `${dimension.question}x` },
      ]) {
        expect(CaseDimensionSchema.safeParse(longer).success).toBe(false)
      }
    }
  })

  it('asks the per-run handled fields', () => {
    expect(preflightPayload().handledWhen).toBeDefined()
    const schema = preflightSchema()
    const wire = schema instanceof z.ZodPipe ? schema.in : schema
    expect(wire instanceof z.ZodObject && 'handled' in wire.shape).toBe(true)
  })
})

describe('runPreflight', () => {
  it('passes when every seat answers the full schema', async () => {
    const result = await runPreflight(cannedJudge(DEFAULT_JUDGE_CONFIG))
    expect(result.ok).toBe(true)
  })

  // The refusal text is the API's, and it never reaches the log: the message
  // is ours, naming only the limit.
  it('names the refused limit and not the refusal text', async () => {
    const refusing: JsonJudgeModel = {
      jsonCompletion: async () => {
        throw new Error(
          'Schemas contains too many optional parameters (25), limit: 24',
        )
      },
    }
    const result = await runPreflight(refusing)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('too many optional parameters')
    expect(result.message).not.toContain('(25)')
  })

  it('fails a verdict that leaves out a required field', async () => {
    const canned = cannedJudge(DEFAULT_JUDGE_CONFIG)
    const partial: JsonJudgeModel = {
      jsonCompletion: async (options) => {
        const result = await canned.jsonCompletion(options)
        const withoutHandled = Object.fromEntries(
          Object.entries(result.object as object).filter(
            ([key]) => key !== 'handled',
          ),
        )
        return { ...result, object: withoutHandled as typeof result.object }
      },
    }
    const result = await runPreflight(partial)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('missing a field')
  })
})

describe('refusalClass', () => {
  it.each([
    ['too many optional parameters (25)', 'too many optional parameters'],
    ['too many union parameters', 'too many union parameters'],
    ['The compiled grammar is too large', 'compiled grammar too large'],
    ['socket hang up', 'an error this check does not recognise'],
  ])('%s', (reason, named) => {
    expect(refusalClass(reason)).toBe(named)
  })
})

describe('main', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // A dry sweep and a local run without the switch make no call.
  it('makes no call unless JUDGE_SPEND is true', async () => {
    vi.stubEnv('JUDGE_SPEND', '')
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    expect(await main()).toBe(0)
    expect(log).toHaveBeenCalledWith(
      'schema preflight skipped: JUDGE_SPEND is not true',
    )
    log.mockRestore()
  })

  // Anything that escapes the call is reported with a fixed sentence and a
  // failing exit, never the error, which can carry the API's response.
  it('fails with a fixed message when the call throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const code = await exitCodeOf(async () => {
      throw new Error('raw API response: secret-looking text')
    })
    const logged = error.mock.calls.flat().map(String).join('\n')
    error.mockRestore()
    expect(code).toBe(1)
    expect(logged).toBe(UNEXPECTED_FAILURE)
  })
})
