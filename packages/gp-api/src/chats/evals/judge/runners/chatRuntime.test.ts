import { describe, expect, it } from 'vitest'
import { ChatScope } from '../../../../generated/prisma'
import type { TestServiceContext } from '@/test-service'
import {
  UnsupportedOnRuntimeError,
  inProcessChatRuntime,
  runtimeRefusal,
  unsupportedText,
  type ChatArmRuntime,
} from './chatRuntime'

// The in-process runtime's real work needs the booted app, and
// chat.integration.test.ts drives all of it through runChatCase. What is
// left here is the two answers it gives without touching anything, both of
// which are load-bearing: a refusal it must never make, and a teardown it
// must never attempt.
const runtime = inProcessChatRuntime({} as TestServiceContext)

describe('the in-process runtime', () => {
  it('is what an arm gets when nothing asked for anything else', () => {
    expect(runtime.kind).toBe('inprocess')
  })

  // Every directive in the case schema was designed against this runtime, so
  // a refusal here is a regression rather than honesty. Pinned against the
  // whole set at once, so a directive added to DriveableCase for the HTTP
  // runtime's sake cannot quietly start refusing cases in process.
  it('refuses nothing the case schema can express', () => {
    expect(() =>
      runtime.assertCanDrive({
        agentId: 'briefing_annotation',
        caseId: 'everything-at-once',
        scope: ChatScope.briefing_annotation,
        accountState: { district: true, pro: true, campaignDetails: true },
        priorTranscript: [{ role: 'user', content: 'hi' }],
        toolFailure: { tool: 'get_my_notes', mode: 'error' },
        script: { steps: [], usage: { inputTokens: 1, outputTokens: 1 } },
        dataVersion: '412',
      }),
    ).not.toThrow()
  })

  // `useTestService` drops the whole database when the suite ends, so by the
  // time anybody could call this the rows are already gone. The HTTP
  // runtime's database outlives the sweep, which is the only reason this is
  // on the interface at all.
  it('removes nothing, because its database is thrown away', async () => {
    await expect(
      runtime.tearDownCase('judge-anything'),
    ).resolves.toBeUndefined()
  })
})

describe('unsupportedText', () => {
  it('names the runtime, the case and every reason', () => {
    expect(
      unsupportedText(
        'http',
        {
          agentId: 'chief_of_staff',
          caseId: 'case-1',
          scope: ChatScope.chief_of_staff,
        },
        ['the first reason', 'the second reason'],
      ),
    ).toBe(
      'chief_of_staff/case-1 cannot be driven on the "http" runtime: the ' +
        'first reason; the second reason',
    )
  })
})

// ONE PREDICATE, ASKED IN TWO PLACES. The planner needs to know whether an
// agent can be driven before it counts it; the runner needs to know whether
// a case can be driven before it spends on it. `runtimeRefusal` is the
// first of those and it CALLS the second, so there is no second list of
// what a runtime supports to drift from the first.
describe('runtimeRefusal', () => {
  const cases = [
    { caseId: 'plain' },
    { caseId: 'seeded', priorTranscript: [{ role: 'user', content: 'hi' }] },
  ] as const

  it('refuses no agent in process, whatever its cases say', () => {
    expect(
      runtimeRefusal(runtime, {
        agentId: 'chief_of_staff',
        scope: ChatScope.chief_of_staff,
        cases: [...cases],
        realModel: true,
      }),
    ).toBeUndefined()
  })

  // Named by case, and by the FIRST one that cannot be driven: an agent is
  // all or nothing here because captureArm has no per-case skip, so the
  // useful thing to report is where to look rather than how many.
  it('names the first case a runtime refuses', () => {
    const refusing: ChatArmRuntime = {
      ...runtime,
      kind: 'http',
      assertCanDrive: (one) => {
        if (one.priorTranscript === undefined) return
        throw new UnsupportedOnRuntimeError(
          unsupportedText('http', one, ['no route writes one']),
        )
      },
    }
    expect(
      runtimeRefusal(refusing, {
        agentId: 'chief_of_staff',
        scope: ChatScope.chief_of_staff,
        cases: [...cases],
        realModel: true,
      }),
    ).toBe(
      'chief_of_staff/seeded cannot be driven on the "http" runtime: no ' +
        'route writes one',
    )
  })

  // A bug in the predicate has to surface as one. Swallowing it here would
  // drop an agent from the sweep with a plausible-looking reason.
  it('does not read any other error as a refusal', () => {
    const broken: ChatArmRuntime = {
      ...runtime,
      assertCanDrive: () => {
        throw new TypeError('cases is not iterable')
      },
    }
    expect(() =>
      runtimeRefusal(broken, {
        agentId: 'chief_of_staff',
        scope: ChatScope.chief_of_staff,
        cases: [...cases],
        realModel: true,
      }),
    ).toThrow(TypeError)
  })
})
