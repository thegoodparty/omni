import { describe, expect, it } from 'vitest'
import type { Bundle, Manifest } from '../schemas/caseScoutBucket.schema'
import { outboundStrings, WITHHELD_NEEDS_SETUP } from './gate.util'
import {
  buildHandoff,
  namesASourceId,
  signStandardWebhook,
} from './handoff.util'

const SESSION_ID = 'conv-7f3a:msg-91c2'

const bundle: Bundle = {
  runId: '2026-11-20',
  drafts: [
    {
      agentId: 'chief_of_staff',
      severity: 3,
      case: {
        caseId: 'turnout-figure-without-source',
        condition: 'Turnout numbers must come with their source.',
        handledWhen: 'The reply names the source or says it has none.',
        source: 'production',
        split: 'tune',
        question: 'What turnout should I expect this fall?',
      },
      failureSummary: `stated turnout unsourced in ${SESSION_ID}`,
    },
    {
      agentId: 'campaign_assistant',
      severity: 2,
      case: {
        caseId: 'two-turn-follow-up',
        condition: 'A follow-up keeps the first answer in view.',
        handledWhen: 'The second reply builds on the first.',
        source: 'production',
        split: 'holdout',
        turns: ['What should I do this week?', 'And next week?'],
      },
      failureSummary: 'lost the thread',
    },
  ],
  needsSetup: [
    { agentId: 'chief_of_staff', severity: 3, what: WITHHELD_NEEDS_SETUP },
    {
      agentId: 'campaign_assistant',
      severity: 2,
      what: 'An account with a recount pending.',
    },
  ],
  listFull: [
    {
      agentId: 'chief_of_staff',
      severity: 2,
      case: {
        caseId: 'list-full-case',
        condition: 'A list-full condition that must stay home.',
        handledWhen: 'A list-full handled-when.',
        source: 'production',
        split: 'tune',
        question: 'A list-full question?',
      },
      failureSummary: 'list full',
    },
  ],
  held: [
    {
      agentId: 'chief_of_staff',
      severity: 3,
      case: {
        caseId: 'held-for-date-case',
        condition: 'A held condition that must stay home.',
        handledWhen: 'A held handled-when.',
        source: 'production',
        split: 'tune',
        question: 'How did the 2028 general election go?',
      },
      failureSummary: 'held for its date',
      reason: 'names 2028; the chat is from 2026',
    },
  ],
  removals: [
    {
      caseId: 'noisy-case',
      agentId: 'chief_of_staff',
      reason: 'a removal reason that must stay home',
    },
  ],
}

const stringsIn = (value: object): string[] =>
  Object.values(value).flatMap((field) =>
    typeof field === 'string'
      ? [field]
      : field !== null && typeof field === 'object'
        ? stringsIn(field)
        : [],
  )

describe('buildHandoff', () => {
  it('maps each draft onto the code-form suite shape', () => {
    expect(buildHandoff(bundle, 'dev')).toEqual({
      version: 1,
      runId: '2026-11-20',
      environment: 'dev',
      cases: [
        {
          suite: 'chief_of_staff',
          id: 'turnout-figure-without-source',
          turns: ['What turnout should I expect this fall?'],
          grading: {
            condition: 'Turnout numbers must come with their source.',
            handledWhen: 'The reply names the source or says it has none.',
          },
          severity: 3,
        },
        {
          suite: 'campaign_assistant',
          id: 'two-turn-follow-up',
          turns: ['What should I do this week?', 'And next week?'],
          grading: {
            condition: 'A follow-up keeps the first answer in view.',
            handledWhen: 'The second reply builds on the first.',
          },
          severity: 2,
        },
      ],
      needsSetup: [
        {
          suite: 'campaign_assistant',
          what: 'An account with a recount pending.',
          severity: 2,
        },
      ],
    })
  })

  it('carries only gated strings, never a source id or an ungated field', () => {
    const handoff = buildHandoff(bundle, 'prod')
    const body = JSON.stringify(handoff)

    expect(body).not.toContain(SESSION_ID)
    expect(body).not.toContain('lost the thread')
    expect(body).not.toContain('list-full')
    expect(body).not.toContain('held-for-date')
    expect(body).not.toContain('2028')
    expect(body).not.toContain('must stay home')
    expect(body).not.toContain('noisy-case')
    expect(body).not.toContain(WITHHELD_NEEDS_SETUP)

    const gated = new Set([
      ...bundle.drafts.flatMap((draft) =>
        outboundStrings({ case: draft.case }),
      ),
      ...bundle.needsSetup.flatMap(({ what }) =>
        outboundStrings({ needsSetup: what }),
      ),
    ])
    const freeText = [
      ...handoff.cases.flatMap(({ turns, grading }) => [
        ...turns,
        ...stringsIn(grading),
      ]),
      ...handoff.needsSetup.map(({ what }) => what),
    ]
    for (const text of freeText) expect(gated).toContain(text)
    for (const { id } of handoff.cases) {
      expect(gated).toContain(id.replace(/[-_]+/gu, ' '))
    }
  })

  it('refuses a draft for a suite the swarm does not write to', () => {
    const other: Bundle = {
      ...bundle,
      drafts: [{ ...bundle.drafts[0]!, agentId: 'ordinance_flow' }],
    }
    expect(() => buildHandoff(other, 'dev')).toThrow()
  })
})

describe('namesASourceId', () => {
  const manifest: Manifest = {
    runId: '2026-11-20',
    startedAt: '2026-11-20T09:17:00.000Z',
    windowStart: null,
    isInternalFilter: false,
    excludedProcessedCount: 0,
    cappedCount: 0,
    oldMarker: { lastSessionStart: null, processedSessionIds: [] },
    scoredSessionIds: [SESSION_ID],
    sessions: [
      {
        sessionId: SESSION_ID,
        conversationId: 'conv-7f3a',
        scope: 'chief_of_staff',
        startedAt: '2026-11-19T10:00:00.000Z',
        messageIds: ['msg-91c2'],
      },
    ],
  }

  it.each([
    ['a conversation id', 'see conv-7f3a', true],
    ['a message id', 'see msg-91c2', true],
    ['none', 'a clean body', false],
  ])('finds %s', (_label, body, found) => {
    expect(namesASourceId(body, manifest)).toBe(found)
  })
})

describe('signStandardWebhook', () => {
  // The worked example in the Standard Webhooks spec's reference tests.
  it('matches the spec', () => {
    expect(
      signStandardWebhook({
        webhookId: 'msg_p5jXN8AQM9LWM0D4loKWxJek',
        timestamp: '1614265330',
        body: '{"test": 2432232314}',
        secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
      }),
    ).toBe('v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=')
  })

  it.each(['MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw', 'whsec_'])(
    'refuses a secret that is not whsec_ with a key (%s)',
    (secret) => {
      expect(() =>
        signStandardWebhook({
          webhookId: 'id',
          timestamp: '1',
          body: '{}',
          secret,
        }),
      ).toThrow('not a whsec_ secret')
    },
  )
})
