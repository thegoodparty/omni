import { describe, expect, it } from 'vitest'
import { ChatScope } from '../../../../generated/prisma'
import type { TestServiceContext } from '@/test-service'
import { inProcessChatRuntime, unsupportedText } from './chatRuntime'

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
