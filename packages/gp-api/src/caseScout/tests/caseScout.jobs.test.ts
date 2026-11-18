import { readFileSync } from 'node:fs'
import path from 'node:path'
import { addMinutes, parseISO } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ChatMessageRole,
  ChatMessageSegmentKind,
  ChatScope,
} from '@/generated/prisma'
import { JobsService } from '@/jobs/jobs.service'
import { useTestService } from '@/test-service'
import { ChatCaseSchema } from '@/chats/evals/judge/cases'
import { SCORING_MODEL } from '../caseScout.prompts'
import {
  BundleSchema,
  LedgerLineSchema,
  ManifestSchema,
  RecordSchema,
  SessionScoreSchema,
  SourcesSchema,
} from '../schemas/caseScoutBucket.schema'
import type { ScoreResponse } from '../schemas/caseScoutModel.schema'
import { CaseScoutBucketService } from '../services/caseScoutBucket.service'
import { CaseScoutCaseListsService } from '../services/caseScoutCaseLists.service'
import {
  CaseScoutModelService,
  ScoreParseError,
} from '../services/caseScoutModel.service'
import { CaseScoutPublisherService } from '../services/caseScoutPublisher.service'
import { SecondReadCallError } from '../util/gate.util'
import { fakeS3 } from './caseScoutTestBucket'

// Drives the real caseScoutNightly schedule and lets the real score and
// draft workers run (src/jobs/AGENTS.md § Tests). Only the edges are
// stubbed: S3, the three model calls, the GitHub case-list read and the
// publisher Lambda.
const service = useTestService({ jobs: true })

const BUCKET = 'case-scout-test'
const RUN_ID = '2026-11-16'
const NOW = parseISO('2026-11-16T09:17:00.000Z')
const FIXTURES = path.join(__dirname, '../fixtures/publisherContract')

let objects: Map<string, string>
let scoreFor: (sessionId: string) => ScoreResponse | Error
let draftFor: (sessionId: string) => string | Error
let secondReadAnswer: () => Promise<string>
let publishCalls: string[]
let transcripts: string[]

const bucketJson = (key: string): string | undefined =>
  objects.get(`${BUCKET}/${key}`)

const readObject = <T>(key: string, parse: (value: string) => T): T => {
  const text = bucketJson(key)
  if (text === undefined) throw new Error(`no ${key} in the fake bucket`)
  return parse(text)
}

// Tonight's lines only: history seeded by a test is not in this side's shape.
const ledgerLines = () =>
  readObject(`ledger/${RUN_ID.slice(0, 7)}.jsonl`, (text) =>
    text
      .trim()
      .split('\n')
      .filter((line) => line.includes(`"runId":"${RUN_ID}"`))
      .map((line) => LedgerLineSchema.parse(JSON.parse(line))),
  )

const record = () =>
  readObject(`runs/${RUN_ID}/record.json`, (text) =>
    RecordSchema.parse(JSON.parse(text)),
  )

const bundle = () =>
  readObject(`runs/${RUN_ID}/bundle.json`, (text) =>
    BundleSchema.parse(JSON.parse(text)),
  )

const sessionIdIn = (transcript: string): string =>
  /^# session (\S+)$/m.exec(transcript)?.[1] ?? ''

const scored = (severity: 0 | 1 | 2 | 3): ScoreResponse => ({
  session_id: 'ignored',
  requests: [
    {
      request_ordinal: 1,
      primary_use_case: 'voter_data',
      answered_request: severity >= 2 ? 'no' : 'yes',
      overall_rating: severity >= 2 ? 'bad' : 'good',
      major_failure_type: severity >= 2 ? 'wrong_or_invented' : 'none',
      known_pattern: severity >= 2 ? 'unsourced_numbers' : 'none',
      severity,
      confidence: 'high',
      human_review_needed: 'no',
      worth_quoting_anonymized: 'no',
      summary_nonidentifying: 'asked for a turnout figure',
      reason_nonidentifying: 'stated a number with no source',
    },
  ],
})

const newCase = (caseId: string, failureSummary: string) =>
  JSON.stringify({
    outcome: 'newCase',
    failureSummary,
    case: {
      caseId,
      question: 'What turnout should I expect in my race this fall?',
      condition: 'Turnout numbers must come with their source or a caveat.',
      handledWhen:
        'The reply names where a turnout number comes from, or says it ' +
        'has none; a failing reply states a bare figure.',
    },
  })

let counter = 0
const seedConversation = async ({
  id,
  scope,
  email,
  firstName = 'Robin',
  lastName = 'Vale',
  organizationSlug,
}: {
  id: string
  scope: ChatScope
  email?: string
  firstName?: string
  lastName?: string
  organizationSlug?: string
}) => {
  counter++
  const owner = await service.prisma.user.create({
    data: {
      email: email ?? `scout-owner-${counter}@example.com`,
      firstName,
      lastName,
    },
  })
  return service.prisma.chatConversation.create({
    data: { id, ownerUserId: owner.id, scope, organizationSlug },
  })
}

const seedMessage = (
  conversationId: string,
  id: string,
  role: ChatMessageRole,
  at: string,
  content: string,
  toolCall?: { toolName: string; payload: { district: string } },
) =>
  service.prisma.chatMessage.create({
    data: {
      id,
      conversationId,
      role,
      content,
      createdAt: parseISO(at),
      ...(toolCall
        ? {
            segments: {
              create: [
                {
                  ordinal: 0,
                  kind: ChatMessageSegmentKind.tool,
                  toolName: toolCall.toolName,
                  payload: toolCall.payload,
                },
              ],
            },
          }
        : {}),
    },
  })

// The night the shared publisher fixtures describe: four sessions across
// three agents, one of them out of scope.
const seedGoldenNight = async () => {
  const owner = await service.prisma.user.create({
    data: {
      email: 'scout-org-owner@example.com',
      firstName: 'Avery',
      lastName: 'Quillon',
    },
  })
  await service.prisma.organization.create({
    data: { slug: 'scout-golden-org', ownerId: owner.id },
  })
  await service.prisma.campaign.create({
    data: {
      slug: 'scout-golden-campaign',
      userId: owner.id,
      organizationSlug: 'scout-golden-org',
      details: { city: 'Lakemoor', campaignCommittee: 'Friends of Avery' },
    },
  })
  await service.prisma.chatConversation.create({
    data: {
      id: 'conv-golden-a',
      ownerUserId: owner.id,
      scope: ChatScope.chief_of_staff,
      organizationSlug: 'scout-golden-org',
    },
  })
  await seedMessage(
    'conv-golden-a',
    'msg-a1',
    ChatMessageRole.user,
    '2026-11-15T14:00:00.000Z',
    'How many people will vote in Lakemoor this fall?',
  )
  await seedMessage(
    'conv-golden-a',
    'msg-a2',
    ChatMessageRole.assistant,
    '2026-11-15T14:01:00.000Z',
    'About 12,400 people will vote.',
    { toolName: 'query_voters', payload: { district: 'ward-2' } },
  )
  await seedMessage(
    'conv-golden-a',
    'msg-a3',
    ChatMessageRole.user,
    '2026-11-15T16:00:00.000Z',
    'Write me a press release.',
  )
  await seedMessage(
    'conv-golden-a',
    'msg-a4',
    ChatMessageRole.assistant,
    '2026-11-15T16:02:00.000Z',
    'Here is a draft.',
  )
  await seedConversation({
    id: 'conv-golden-b',
    scope: ChatScope.campaign_assistant,
  })
  await seedMessage(
    'conv-golden-b',
    'msg-b1',
    ChatMessageRole.user,
    '2026-11-15T15:00:00.000Z',
    'What should I do this week?',
  )
  await seedMessage(
    'conv-golden-b',
    'msg-b2',
    ChatMessageRole.assistant,
    '2026-11-15T15:01:00.000Z',
    'Knock doors on Saturday.',
  )
  await seedConversation({
    id: 'conv-golden-c',
    scope: ChatScope.ordinance_flow,
  })
  await seedMessage(
    'conv-golden-c',
    'msg-c1',
    ChatMessageRole.user,
    '2026-11-15T15:30:00.000Z',
    'Find the noise ordinance.',
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
  vi.stubEnv('CASE_SCOUT_ENABLED', 'true')
  vi.stubEnv('CASE_SCOUT_BUCKET', BUCKET)
  vi.stubEnv('CASE_SCOUT_LAMBDA_FUNCTION_NAME', 'case-scout-test')
  vi.stubEnv('CASE_SCOUT_SPEND_CAP_USD', '')
  vi.stubEnv('CASE_SCOUT_SESSION_CAP', '')
  vi.stubEnv('CASE_SCOUT_JUDGE_RECORDS_BUCKET', '')
  vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'dev')

  objects = fakeS3(service.app.get(CaseScoutBucketService))
  transcripts = []
  publishCalls = []
  scoreFor = () => scored(0)
  draftFor = () => new Error('no draft scripted')
  secondReadAnswer = async () => '[]'

  const model = service.app.get(CaseScoutModelService)
  vi.spyOn(model, 'scoreTranscript').mockImplementation(async (transcript) => {
    transcripts.push(transcript)
    const result = scoreFor(sessionIdIn(transcript))
    if (result instanceof Error) throw result
    return result
  })
  vi.spyOn(model, 'draftCase').mockImplementation(async (_system, text) => {
    const result = draftFor(sessionIdIn(text))
    if (result instanceof Error) throw result
    return result
  })
  vi.spyOn(model, 'secondRead').mockImplementation(() => secondReadAnswer())

  vi.spyOn(
    service.app.get(CaseScoutCaseListsService),
    'read',
  ).mockImplementation(async (agentId) => ({
    agentId,
    caseCount: 11,
    caseIds: new Set(['existing-case']),
    conditions: ['An existing condition the judge already checks.'],
    fixtureDescription: 'The fixture account.',
  }))

  // Stands in for the publisher Lambda, which advances the marker on success.
  vi.spyOn(
    service.app.get(CaseScoutPublisherService),
    'invoke',
  ).mockImplementation(async (runId) => {
    publishCalls.push(runId)
    const recordText = bucketJson(`runs/${runId}/record.json`) ?? '{}'
    const { newMarker } = RecordSchema.parse(JSON.parse(recordText))
    objects.set(
      `${BUCKET}/marker.json`,
      JSON.stringify({ ...newMarker, updatedByRun: runId }),
    )
    return {
      payload: JSON.stringify({
        statusCode: 200,
        body: JSON.stringify({ status: 'dry_run', runId, prUrl: null }),
      }),
    }
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('caseScoutNightly', () => {
  it('does nothing while CASE_SCOUT_ENABLED is off', async () => {
    vi.stubEnv('CASE_SCOUT_ENABLED', '')
    await seedGoldenNight()

    await service.jobs.runSchedule('caseScoutNightly')

    expect(objects.size).toBe(0)
    expect(transcripts).toEqual([])
    expect(publishCalls).toEqual([])
  })

  it('writes the files the publisher reads, as the shared fixtures pin', async () => {
    await seedGoldenNight()
    scoreFor = (sessionId) =>
      ({
        'conv-golden-a:msg-a1': scored(3),
        'conv-golden-a:msg-a3': scored(2),
        'conv-golden-b:msg-b1': scored(1),
      })[sessionId] ?? new Error(`unexpected score for ${sessionId}`)
    draftFor = (sessionId) =>
      sessionId === 'conv-golden-a:msg-a1'
        ? newCase('turnout-figure-without-source', 'states turnout unsourced')
        : JSON.stringify({
            outcome: 'coveredBy',
            failureSummary: 'press release drafted without facts',
            caseId: 'existing-case',
          })

    await service.jobs.runSchedule('caseScoutNightly')

    const fixture = (name: string) =>
      readFileSync(path.join(FIXTURES, name), 'utf8')
    expect(bundle()).toEqual(JSON.parse(fixture('bundle.json')))
    expect(
      readObject(`runs/${RUN_ID}/sources.json`, (t) =>
        SourcesSchema.parse(JSON.parse(t)),
      ),
    ).toEqual(JSON.parse(fixture('sources.json')))
    expect(record()).toEqual(JSON.parse(fixture('record.json')))
    expect(ledgerLines()).toEqual(
      fixture('ledger.jsonl')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    )
    expect(publishCalls).toEqual([RUN_ID])

    expect(bucketJson(`claims/${RUN_ID}`)).toBeDefined()
    // The out-of-scope ordinance session is never sent to the model.
    expect(transcripts.map(sessionIdIn).sort()).toEqual([
      'conv-golden-a:msg-a1',
      'conv-golden-a:msg-a3',
      'conv-golden-b:msg-b1',
    ])
    for (const draft of bundle().drafts) {
      expect(ChatCaseSchema.safeParse(draft.case).success).toBe(true)
    }
  })

  it('renders tool calls into the transcript and keeps contact data out', async () => {
    await seedGoldenNight()

    await service.jobs.runSchedule('caseScoutNightly')

    const first = transcripts.find((t) => t.includes('msg-a2'))
    expect(first).toContain('tool: query_voters input: {"district":"ward-2"}')
    expect(first).toContain(
      '**assistant** (#2, msg-a2, 2026-11-15T14:01:00+00:00)',
    )
    expect(transcripts.join('\n')).not.toContain('@example.com')
  })

  it('stands down when someone else already claimed the night', async () => {
    await seedGoldenNight()
    objects.set(`${BUCKET}/claims/${RUN_ID}`, '{}')

    await service.jobs.runSchedule('caseScoutNightly')

    expect(transcripts).toEqual([])
    expect(bucketJson(`runs/${RUN_ID}/manifest.json`)).toBeUndefined()
  })

  it('reads from an hour before the marker and skips processed sessions', async () => {
    await seedConversation({ id: 'conv-ov', scope: ChatScope.chief_of_staff })
    // Read last night; inside tonight's overlap window and already processed.
    await seedMessage(
      'conv-ov',
      'msg-old',
      ChatMessageRole.user,
      '2026-11-15T07:40:00.000Z',
      'An older question.',
    )
    // Before the window entirely.
    await seedMessage(
      'conv-ov',
      'msg-ancient',
      ChatMessageRole.user,
      '2026-11-14T07:00:00.000Z',
      'A much older question.',
    )
    await seedConversation({ id: 'conv-ov2', scope: ChatScope.chief_of_staff })
    await seedMessage(
      'conv-ov2',
      'msg-new',
      ChatMessageRole.user,
      '2026-11-15T08:30:00.000Z',
      'A new question.',
    )
    objects.set(
      `${BUCKET}/marker.json`,
      JSON.stringify({
        lastSessionStart: '2026-11-15T08:00:00+00:00',
        processedSessionIds: ['conv-ov:msg-old'],
        updatedByRun: '2026-11-15',
      }),
    )

    await service.jobs.runSchedule('caseScoutNightly')

    const manifest = ManifestSchema.parse(
      JSON.parse(bucketJson(`runs/${RUN_ID}/manifest.json`) ?? '{}'),
    )
    expect(manifest.windowStart).toBe('2026-11-15T07:00:00.000Z')
    expect(manifest.excludedProcessedCount).toBe(1)
    expect(manifest.sessions.map((s) => s.sessionId)).toEqual([
      'conv-ov2:msg-new',
    ])
    // The old cutoff is still inside the new overlap window, so its ids carry
    // forward: the old session can still be read again.
    expect(record().newMarker).toEqual({
      lastSessionStart: '2026-11-15T08:30:00.000Z',
      processedSessionIds: ['conv-ov:msg-old', 'conv-ov2:msg-new'],
    })
  })

  it('caps the sessions a night reads, oldest first', async () => {
    vi.stubEnv('CASE_SCOUT_SESSION_CAP', '2')
    for (const hour of [10, 12, 14]) {
      const id = `conv-cap-${hour}`
      await seedConversation({ id, scope: ChatScope.chief_of_staff })
      await seedMessage(
        id,
        `msg-cap-${hour}`,
        ChatMessageRole.user,
        `2026-11-15T${hour}:00:00.000Z`,
        'A question.',
      )
    }

    await service.jobs.runSchedule('caseScoutNightly')

    const manifest = ManifestSchema.parse(
      JSON.parse(bucketJson(`runs/${RUN_ID}/manifest.json`) ?? '{}'),
    )
    expect(manifest.cappedCount).toBe(1)
    expect(manifest.sessions.map((s) => s.conversationId)).toEqual([
      'conv-cap-10',
      'conv-cap-12',
    ])
  })
})

describe('caseScoutDraft', () => {
  const seedSessions = async (severities: number[]) => {
    for (const [index, severity] of severities.entries()) {
      const id = `conv-sev-${index}-${severity}`
      await seedConversation({ id, scope: ChatScope.chief_of_staff })
      await seedMessage(
        id,
        `msg-sev-${index}`,
        ChatMessageRole.user,
        addMinutes(parseISO('2026-11-15T10:00:00.000Z'), index).toISOString(),
        'A question.',
      )
    }
    scoreFor = (sessionId) => {
      const severity = Number(/-(\d):/.exec(sessionId)?.[1])
      return scored(severity === 3 ? 3 : severity === 2 ? 2 : 0)
    }
  }

  it('drafts severity 2 and 3, worst first, up to the nightly cap', async () => {
    await seedSessions([2, 3, 0, 3, 2, 3])
    draftFor = (sessionId) =>
      newCase(`case-${sessionId.split(':')[1]}`, `failure ${sessionId}`)

    await service.jobs.runSchedule('caseScoutNightly')

    const lines = ledgerLines()
    expect(lines.map((l) => [l.sessionId.split(':')[1], l.outcome])).toEqual([
      ['msg-sev-1', 'proposed'],
      ['msg-sev-3', 'proposed'],
      ['msg-sev-5', 'proposed'],
      ['msg-sev-0', 'capped'],
      ['msg-sev-4', 'capped'],
    ])
    expect(record().counts).toMatchObject({ candidates: 5, capped: 2 })
  })

  it('suppresses duplicates, rejections and caseId collisions', async () => {
    await seedSessions([3, 3, 3])
    const earlier = parseISO('2026-11-10T09:30:00.000Z').toISOString()
    const history = [
      {
        runId: '2026-11-10',
        conversationId: 'conv-sev-0-3',
        sessionId: 'conv-sev-0-3:msg-x',
        agentId: 'chief_of_staff',
        severity: 3,
        outcome: 'proposed',
        caseId: 'proposed-before',
        failureSummary: 'Repeat Failure',
        createdAt: earlier,
      },
      {
        runId: '2026-11-08',
        conversationId: 'conv-sev-1-3',
        agentId: 'chief_of_staff',
        outcome: 'rejected',
        caseId: 'rejected-before',
        failureSummary: 'rejected failure',
        closedAt: earlier,
        createdAt: earlier,
      },
    ]
    objects.set(
      `${BUCKET}/ledger/2026-11.jsonl`,
      history.map((line) => JSON.stringify(line)).join('\n') + '\n',
    )
    draftFor = (sessionId) =>
      ({
        'conv-sev-0-3:msg-sev-0': newCase('fresh-a', 'repeat   failure'),
        'conv-sev-1-3:msg-sev-1': newCase('fresh-b', 'Rejected failure'),
        'conv-sev-2-3:msg-sev-2': newCase('existing-case', 'collides'),
      })[sessionId] ?? new Error('unexpected')
    vi.stubEnv('CASE_SCOUT_JUDGE_RECORDS_BUCKET', '')

    await service.jobs.runSchedule('caseScoutNightly')

    const tonight = ledgerLines()
    expect(tonight.map((l) => [l.outcome, l.caseId, l.coveredBy])).toEqual([
      ['covered', null, 'proposed-before'],
      ['suppressed', 'rejected-before', null],
      ['error', null, null],
    ])
    expect(tonight[2]?.failureSummary).toContain('collides')
    // None of them reaches the gate's paid second read.
    expect(
      service.app.get(CaseScoutModelService).secondRead,
    ).not.toHaveBeenCalled()
    // History written by others is left as it was.
    expect(bucketJson('ledger/2026-11.jsonl')).toContain(
      JSON.stringify(history[1]),
    )
  })

  it('drops a draft the gate blocks, and fails closed on the second read', async () => {
    await seedSessions([3, 3])
    draftFor = (sessionId) =>
      sessionId.startsWith('conv-sev-0')
        ? JSON.stringify({
            outcome: 'newCase',
            failureSummary: 'leaks a phone',
            case: {
              caseId: 'leaky',
              question: 'Call me at 555-123-4567 about turnout.',
              condition: 'A condition.',
              handledWhen: 'A handled-when.',
            },
          })
        : newCase('second-read-down', 'second read unavailable')
    secondReadAnswer = async () => {
      throw new SecondReadCallError('Anthropic is down')
    }

    await service.jobs.runSchedule('caseScoutNightly')

    expect(
      ledgerLines().map((l) => [l.outcome, l.gateFailures, l.failureSummary]),
    ).toEqual([
      ['gated', ['contactPattern'], 'a phone number appeared in a case field'],
      ['gated', ['secondRead'], 'the second read call failed'],
    ])
    expect(bundle().drafts).toEqual([])
  })

  it('stops spending once the night passes the spend cap', async () => {
    vi.stubEnv('CASE_SCOUT_SPEND_CAP_USD', '1')
    await seedSessions([3, 3, 3, 3, 3, 3])
    draftFor = (sessionId) => newCase(`c-${sessionId.slice(-1)}`, sessionId)

    await service.jobs.runSchedule('caseScoutNightly')

    const run = record()
    // Each concurrent score job can read the total just under the cap, so
    // the score stage overshoots by at most one call per job in flight.
    expect(run.spendUsd.score).toBeLessThanOrEqual(1 + 4 * 0.75)
    expect(run.spendCapHit).toBe(true)
    expect(run.counts.proposed).toBe(0)
    const capped = Object.values(
      Object.fromEntries(
        [...objects.entries()].filter(([key]) => key.includes('/scores/')),
      ),
    )
      .map((text) => SessionScoreSchema.parse(JSON.parse(text)))
      .filter((score) => score.status === 'spendCapped')
    expect(capped.length).toBeGreaterThan(0)
    // A capped session is never marked processed, so a later night reads it.
    for (const score of capped) {
      expect(run.newMarker.processedSessionIds).not.toContain(score.sessionId)
    }
    expect(publishCalls).toEqual([RUN_ID])
  })

  it('drafts the night even when a score job dead-letters', async () => {
    await seedSessions([3, 3])
    scoreFor = (sessionId) =>
      sessionId.startsWith('conv-sev-0')
        ? new Error('Anthropic overloaded')
        : scored(3)
    draftFor = () => newCase('survivor', 'the surviving failure')

    const { deadLetters } = await service.jobs.runSchedule('caseScoutNightly', {
      allowDeadLetters: true,
    })

    expect(deadLetters.map((d) => d.name)).toEqual(['caseScoutScoreSession'])
    expect(record().errors).toEqual([
      'session conv-sev-0-3:msg-sev-0: scoring call failed',
    ])
    expect(bundle().drafts.map((d) => d.case.caseId)).toEqual(['survivor'])
    expect(publishCalls).toEqual([RUN_ID])
  })

  it('records a reply that never parses as a scoring error, not a retry', async () => {
    await seedSessions([3])
    scoreFor = () => new ScoreParseError('unreadable')

    await service.jobs.runSchedule('caseScoutNightly')

    expect(
      service.app.get(CaseScoutModelService).scoreTranscript,
    ).toHaveBeenCalledTimes(2)
    expect(record().errors[0]).toContain('could not be parsed after retry')
    expect(record().model).toBe(SCORING_MODEL)
  })

  it('re-running after a publish neither redrafts nor republishes', async () => {
    await seedSessions([3])
    draftFor = () => newCase('once-only', 'one failure')
    await service.jobs.runSchedule('caseScoutNightly')
    const draftCalls = vi.mocked(
      service.app.get(CaseScoutModelService).draftCase,
    ).mock.calls.length

    await service.app
      .get(JobsService)
      .sendMany('caseScoutDraft', [{ data: { runId: RUN_ID }, key: RUN_ID }])
    await service.jobs.settle()

    expect(publishCalls).toEqual([RUN_ID])
    expect(
      vi.mocked(service.app.get(CaseScoutModelService).draftCase).mock.calls,
    ).toHaveLength(draftCalls)
  })

  it('republishes, without redrafting, when the last publish failed', async () => {
    await seedSessions([3])
    draftFor = () => newCase('retry-publish', 'one failure')
    const publisher = service.app.get(CaseScoutPublisherService)
    vi.mocked(publisher.invoke).mockResolvedValueOnce({
      functionError: 'Unhandled',
      payload: '{"errorMessage":"GitHub down"}',
    })

    await service.jobs.runSchedule('caseScoutNightly')

    expect(
      vi.mocked(service.app.get(CaseScoutModelService).draftCase),
    ).toHaveBeenCalledTimes(1)
    expect(publishCalls).toEqual([RUN_ID])
    expect(ledgerLines()).toHaveLength(1)
  })
})
