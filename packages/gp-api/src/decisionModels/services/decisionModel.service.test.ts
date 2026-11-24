import { HttpStatus } from '@nestjs/common'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest'
import { ZodError } from 'zod'
import { DecisionModelError } from '../decisionModel.error'
import {
  EXPECTED_WIRE_QUESTIONS,
  FICTIONAL_REPLY,
  GEMINI_BLOCKED,
  GEMINI_INVALID_KEY_400,
  GEMINI_SAFETY_400,
  GEMINI_SUCCESS,
  QUESTIONS,
  TYPESAFE_SUCCESS,
} from '../fixtures/decisionModels.fixtures'
import { GEMINI_DECISIONS_URL } from '../providers/gemini.provider'
import { TYPESAFE_SYSTEM_ONE_URL } from '../providers/typesafe.provider'
import { DecisionModelService } from './decisionModel.service'

const TEST_GEMINI_KEY = 'test-gemini-key'
const TEST_TYPESAFE_KEY = 'test-typesafe-key'

const service = new DecisionModelService()

const jsonResponse = (body: object, status: number = HttpStatus.OK) =>
  new Response(JSON.stringify(body), { status })

let fetchSpy: MockInstance<typeof fetch>

const sentRequest = () => {
  const [url, init] = fetchSpy.mock.calls[0] ?? []
  return {
    url: String(url),
    headers: new Headers(init?.headers),
    body: JSON.parse(String(init?.body)) as Record<string, object | string>,
  }
}

const decideError = async (): Promise<DecisionModelError> => {
  const error = await service
    .decide({ input: FICTIONAL_REPLY, questions: QUESTIONS })
    .catch((err: Error) => err)
  expect(error).toBeInstanceOf(DecisionModelError)
  return error as DecisionModelError
}

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch')
  vi.stubEnv('GEMINI_API_KEY', TEST_GEMINI_KEY)
  vi.stubEnv('TYPESAFE_API_KEY', TEST_TYPESAFE_KEY)
  vi.stubEnv('DECISION_MODEL_PROVIDER', undefined)
  vi.stubEnv('DECISION_MODEL_ID', undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('DecisionModelService.decide with gemini (the default)', () => {
  it('maps the questions onto the decisions body and the answers back', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(GEMINI_SUCCESS))

    const result = await service.decide({
      input: FICTIONAL_REPLY,
      questions: QUESTIONS,
    })

    const sent = sentRequest()
    expect(sent.url).toBe(GEMINI_DECISIONS_URL)
    expect(sent.headers.get('x-goog-api-key')).toBe(TEST_GEMINI_KEY)
    expect(sent.body).toEqual({
      model: 'gemini-decision-1',
      input: FICTIONAL_REPLY,
      questions: EXPECTED_WIRE_QUESTIONS,
    })
    expect(result).toEqual({
      answers: {
        thanks: {
          type: 'yesNo',
          value: true,
          probabilities: { true: 0.97, false: 1 - 0.97 },
          confidence: 0.9,
        },
        bare: {
          type: 'yesNo',
          value: false,
          probabilities: { true: 0.04, false: 1 - 0.04 },
          confidence: 0.95,
        },
        topic: {
          type: 'choice',
          value: 'library',
          probabilities: { library: 0.92, roads: 0.01, other: 0.07 },
          confidence: 0.88,
        },
        warmth: {
          type: 'score',
          value: 2,
          probabilities: { '0': 0.02, '1': 0.18, '2': 0.8 },
          confidence: 0.7,
        },
      },
      usage: { inputTokens: 412 },
      model: 'gemini-decision-1',
      provider: 'gemini',
      costUsd: (412 / 1_000_000) * 0.1,
    })
  })

  it('sends DECISION_MODEL_ID as the model and prices an unknown one as null', async () => {
    vi.stubEnv('DECISION_MODEL_ID', 'gemini-decision-2')
    fetchSpy.mockResolvedValue(jsonResponse(GEMINI_SUCCESS))

    const result = await service.decide({
      input: FICTIONAL_REPLY,
      questions: QUESTIONS,
    })

    expect(sentRequest().body.model).toBe('gemini-decision-2')
    expect(result.costUsd).toBeNull()
  })

  it('throws safety_block when answers are empty and a block reason is set', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(GEMINI_BLOCKED))

    const error = await decideError()

    expect(error.reason).toBe('safety_block')
    expect(error.detail.blockReason).toBe('SAFETY')
  })

  it('throws input_rejected on a 400 carrying no key failure', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(GEMINI_SAFETY_400, HttpStatus.BAD_REQUEST),
    )

    const error = await decideError()

    expect(error.reason).toBe('input_rejected')
    expect(error.detail).toEqual({
      httpStatus: HttpStatus.BAD_REQUEST,
      providerStatus: 'INVALID_ARGUMENT',
    })
  })

  it('throws unauthorized on the recorded invalid-key 400', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse(GEMINI_INVALID_KEY_400, HttpStatus.BAD_REQUEST),
    )

    const error = await decideError()

    expect(error.reason).toBe('unauthorized')
    expect(error.detail.providerStatus).toBe('API_KEY_INVALID')
  })

  it('throws provider_error on a 5xx and on a network failure', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('upstream', { status: HttpStatus.SERVICE_UNAVAILABLE }),
    )
    expect((await decideError()).reason).toBe('provider_error')

    fetchSpy.mockRejectedValueOnce(new TypeError('fetch failed'))
    expect((await decideError()).reason).toBe('provider_error')
  })

  it.each([
    ['a body that is not JSON', 'not json'],
    [
      'a probability outside 0 to 1',
      JSON.stringify({
        ...GEMINI_SUCCESS,
        answers: {
          ...GEMINI_SUCCESS.answers,
          thanks: { type: 'noul', noul: 1.4 },
        },
      }),
    ],
    [
      'a question left unanswered',
      JSON.stringify({
        ...GEMINI_SUCCESS,
        answers: { ...GEMINI_SUCCESS.answers, thanks: undefined },
      }),
    ],
    [
      'an answer of the wrong type',
      JSON.stringify({
        ...GEMINI_SUCCESS,
        answers: {
          ...GEMINI_SUCCESS.answers,
          bare: GEMINI_SUCCESS.answers.topic,
        },
      }),
    ],
    [
      'a choice that was not an option',
      JSON.stringify({
        ...GEMINI_SUCCESS,
        answers: {
          ...GEMINI_SUCCESS.answers,
          topic: { ...GEMINI_SUCCESS.answers.topic, choice: 'parks' },
        },
      }),
    ],
    ['no usage', JSON.stringify({ ...GEMINI_SUCCESS, usage: undefined })],
  ])('throws invalid_response for %s', async (_case, body) => {
    fetchSpy.mockResolvedValue(new Response(body, { status: HttpStatus.OK }))

    expect((await decideError()).reason).toBe('invalid_response')
  })

  it('throws not_configured without calling out when the key is unset', async () => {
    vi.stubEnv('GEMINI_API_KEY', undefined)

    expect((await decideError()).reason).toBe('not_configured')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('rejects a question key outside the allowed pattern before calling out', async () => {
    await expect(
      service.decide({
        input: FICTIONAL_REPLY,
        questions: { 'has space': QUESTIONS.bare },
      }),
    ).rejects.toBeInstanceOf(ZodError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('DecisionModelService.decide with typesafe', () => {
  beforeEach(() => {
    vi.stubEnv('DECISION_MODEL_PROVIDER', 'typesafe')
  })

  it('maps the questions onto the systemone body and the answers back', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(TYPESAFE_SUCCESS))

    const result = await service.decide({
      input: FICTIONAL_REPLY,
      questions: QUESTIONS,
    })

    const sent = sentRequest()
    expect(sent.url).toBe(TYPESAFE_SYSTEM_ONE_URL)
    expect(sent.headers.get('authorization')).toBe(
      `Bearer ${TEST_TYPESAFE_KEY}`,
    )
    expect(sent.headers.get('x-goog-api-key')).toBeNull()
    expect(sent.body).toEqual({
      model: 'jev-latest',
      state: FICTIONAL_REPLY,
      questions: EXPECTED_WIRE_QUESTIONS,
    })
    expect(result.answers.thanks).toEqual({
      type: 'yesNo',
      value: true,
      probabilities: { true: 0.95, false: 1 - 0.95 },
    })
    expect(result.answers.topic.value).toBe('library')
    expect(result.answers.warmth.value).toBe(2)
    expect(result).toMatchObject({
      usage: { inputTokens: 380, outputTokens: 12 },
      model: 'jev-1',
      provider: 'typesafe',
      costUsd: null,
    })
  })

  it('throws not_configured when TYPESAFE_API_KEY is unset', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', undefined)

    expect((await decideError()).reason).toBe('not_configured')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('throws unauthorized on a 401', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({ error: 'unauthorized' }, HttpStatus.UNAUTHORIZED),
    )

    expect((await decideError()).reason).toBe('unauthorized')
  })

  it('throws invalid_response for a noul answer with no probability', async () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        ...TYPESAFE_SUCCESS,
        answers: { ...TYPESAFE_SUCCESS.answers, thanks: { type: 'noul' } },
      }),
    )

    expect((await decideError()).reason).toBe('invalid_response')
  })
})

describe('provider selection', () => {
  it('treats a blank DECISION_MODEL_PROVIDER as gemini', async () => {
    vi.stubEnv('DECISION_MODEL_PROVIDER', ' ')
    fetchSpy.mockResolvedValue(jsonResponse(GEMINI_SUCCESS))

    const result = await service.decide({
      input: FICTIONAL_REPLY,
      questions: QUESTIONS,
    })

    expect(result.provider).toBe('gemini')
    expect(sentRequest().url).toBe(GEMINI_DECISIONS_URL)
  })

  it('refuses an unknown provider instead of falling back to one', async () => {
    vi.stubEnv('DECISION_MODEL_PROVIDER', 'typsafe')

    await expect(
      service.decide({ input: FICTIONAL_REPLY, questions: QUESTIONS }),
    ).rejects.toBeInstanceOf(ZodError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
