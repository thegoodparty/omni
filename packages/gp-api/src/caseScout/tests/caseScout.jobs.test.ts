import { createHmac } from 'node:crypto'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { addMinutes, getUnixTime, parseISO } from 'date-fns'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { CaseScoutHandoffSchema } from '@goodparty_org/contracts'
import {
  AgentMessageRole,
  ChatMessageRole,
  ChatScope,
} from '@/generated/prisma'
import { JobsService } from '@/jobs/jobs.service'
import { useTestService } from '@/test-service'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { SlackChannel } from '@/vendors/slack/slackService.types'
import { ChatCaseSchema } from '@/chats/evals/judge/cases'
import { SCORING_MODEL } from '../caseScout.prompts'
import {
  BundleSchema,
  DeliverySchema,
  LedgerLineSchema,
  ManifestSchema,
  MarkerSchema,
  RecordSchema,
  SessionScoreSchema,
} from '../schemas/caseScoutBucket.schema'
import type { ScoreResponse } from '../schemas/caseScoutModel.schema'
import { CaseScoutBucketService } from '../services/caseScoutBucket.service'
import { CaseScoutCaseListsService } from '../services/caseScoutCaseLists.service'
import {
  CaseScoutModelService,
  ScoreParseError,
} from '../services/caseScoutModel.service'
import { SecondReadCallError, WITHHELD_NEEDS_SETUP } from '../util/gate.util'
import { fakeS3 } from './caseScoutTestBucket'

// Drives the real caseScoutNightly schedule and lets the real score and
// draft workers run (src/jobs/AGENTS.md § Tests). Only the edges are
// stubbed: S3, the three model calls, the GitHub case-list read and Slack.
// The Delegate webhook is a real HTTP server on localhost.
const service = useTestService({ jobs: true })

const BUCKET = 'case-scout-test'
const RUN_ID = '2026-11-16'
const NOW = parseISO('2026-11-16T09:17:00.000Z')
const WEBHOOK_KEY = Buffer.from('a-test-key-for-the-handoff-only!')
const WEBHOOK_SECRET = `whsec_${WEBHOOK_KEY.toString('base64')}`

let objects: Map<string, string>
let scoreFor: (sessionId: string) => ScoreResponse | Error
let draftFor: (sessionId: string) => string | Error
let secondReadAnswer: () => Promise<string>
let transcripts: string[]
let notes: { text: string; channel: SlackChannel }[]
let slackAnswer: () => string | undefined

type WebhookRequest = { headers: IncomingHttpHeaders; body: string }
let webhook: Server
let webhookUrl: string
let requests: WebhookRequest[]
let webhookStatus: () => number

beforeAll(async () => {
  webhook = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      requests.push({
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      })
      res.statusCode = webhookStatus()
      res.end()
    })
  })
  await new Promise<void>((resolve) => webhook.listen(0, '127.0.0.1', resolve))
  const { port } = webhook.address() as AddressInfo
  webhookUrl = `http://127.0.0.1:${port}/hooks/case-scout`
})

afterAll(async () => {
  await new Promise((resolve) => webhook.close(resolve))
})

const sendToDelegate = () => {
  vi.stubEnv('CASE_SCOUT_SEND_TO_DELEGATE', 'true')
  vi.stubEnv('CASE_SCOUT_DELEGATE_WEBHOOK_URL', webhookUrl)
  vi.stubEnv('CASE_SCOUT_DELEGATE_WEBHOOK_SECRET', WEBHOOK_SECRET)
}

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

const marker = () =>
  MarkerSchema.parse(JSON.parse(bucketJson('marker.json') ?? '{}'))

const manifestIds = () => {
  const { sessions } = ManifestSchema.parse(
    JSON.parse(bucketJson(`runs/${RUN_ID}/manifest.json`) ?? '{}'),
  )
  return sessions.flatMap((s) => [
    s.sessionId,
    s.conversationId,
    ...s.messageIds,
  ])
}

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

const seedMessage = async (
  conversationId: string,
  id: string,
  role: ChatMessageRole,
  at: string,
  content: string,
  toolCall?: { toolName: string; payload: { district: string } },
) => {
  const index = await service.prisma.agentMessage.count({
    where: { conversationId },
  })
  return service.prisma.agentMessage.create({
    data: {
      id,
      conversationId,
      index,
      role:
        role === ChatMessageRole.user
          ? AgentMessageRole.user
          : AgentMessageRole.assistant,
      createdAt: parseISO(at),
      parts: [
        ...(toolCall
          ? [
              {
                type: 'tool-call',
                toolCallId: '',
                toolName: toolCall.toolName,
                input: toolCall.payload,
              },
            ]
          : []),
        { type: 'text', text: content },
      ],
    },
  })
}

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
  vi.stubEnv('CASE_SCOUT_SEND_TO_DELEGATE', '')
  vi.stubEnv('CASE_SCOUT_SPEND_CAP_USD', '')
  vi.stubEnv('CASE_SCOUT_SESSION_CAP', '')
  vi.stubEnv('CASE_SCOUT_JUDGE_RECORDS_BUCKET', '')
  vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'dev')

  objects = fakeS3(service.app.get(CaseScoutBucketService))
  transcripts = []
  notes = []
  requests = []
  slackAnswer = () => 'ok'
  webhookStatus = () => 204
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

  vi.spyOn(service.app.get(SlackService), 'message').mockImplementation(
    async (message, channel) => {
      notes.push({ text: message.text ?? '', channel })
      return slackAnswer()
    },
  )
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
    expect(notes).toEqual([])
  })

  it('holds the night in the bucket, posts the note and moves the marker', async () => {
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

    expect(
      CaseScoutHandoffSchema.parse(
        JSON.parse(bucketJson(`runs/${RUN_ID}/handoff.json`) ?? '{}'),
      ),
    ).toEqual({
      version: 1,
      runId: RUN_ID,
      environment: 'dev',
      cases: [
        {
          suite: 'chief_of_staff',
          id: 'turnout-figure-without-source',
          turns: ['What turnout should I expect in my race this fall?'],
          grading: {
            condition:
              'Turnout numbers must come with their source or a caveat.',
            handledWhen:
              'The reply names where a turnout number comes from, or says ' +
              'it has none; a failing reply states a bare figure.',
          },
          severity: 3,
        },
      ],
      needsSetup: [],
    })
    expect(requests).toEqual([])
    expect(bucketJson(`runs/${RUN_ID}/delivery.json`)).toBeUndefined()
    expect(marker()).toEqual({
      lastSessionStart: '2026-11-15T16:00:00.000Z',
      processedSessionIds: [
        'conv-golden-b:msg-b1',
        'conv-golden-c:msg-c1',
        'conv-golden-a:msg-a3',
      ],
      updatedByRun: RUN_ID,
    })
    expect(notes).toHaveLength(1)
    expect(notes[0]?.channel).toBe(SlackChannel.botDev)
    expect(notes[0]?.text).toContain(
      `Handoff: held at ${BUCKET}/runs/${RUN_ID}/handoff.json`,
    )
    expect(notes[0]?.text).toContain(
      '`turnout-figure-without-source` (chief_of_staff, severity 3), ' +
        'conversation `conv-golden-a`',
    )
    expect(notes[0]?.text).toContain(
      'FROM gp_api_pg_dev.public.agent_message WHERE conversation_id IN ' +
        "('conv-golden-a')",
    )

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

  it('reads only the last 24 hours and the overlap with no marker', async () => {
    await seedConversation({ id: 'conv-fn', scope: ChatScope.chief_of_staff })
    // A minute before the window: 24 hours and the 60-minute overlap before
    // the 09:17 run.
    await seedMessage(
      'conv-fn',
      'msg-fn-old',
      ChatMessageRole.user,
      '2026-11-15T08:16:00.000Z',
      'An older question.',
    )
    await seedConversation({ id: 'conv-fn2', scope: ChatScope.chief_of_staff })
    await seedMessage(
      'conv-fn2',
      'msg-fn-new',
      ChatMessageRole.user,
      '2026-11-15T08:17:00.000Z',
      'A new question.',
    )

    await service.jobs.runSchedule('caseScoutNightly')

    const manifest = ManifestSchema.parse(
      JSON.parse(bucketJson(`runs/${RUN_ID}/manifest.json`) ?? '{}'),
    )
    expect(manifest.windowStart).toBe('2026-11-15T08:17:00.000Z')
    expect(manifest.sessions.map((s) => s.sessionId)).toEqual([
      'conv-fn2:msg-fn-new',
    ])
    expect(transcripts.map(sessionIdIn)).toEqual(['conv-fn2:msg-fn-new'])
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

describe('caseScoutDraft', () => {
  it('drafts severity 2 and 3, worst first, up to the nightly cap', async () => {
    await seedSessions([2, 3, 0, 3, 2, 3])
    draftFor = (sessionId) =>
      newCase(`case-${sessionId.slice(-1)}`, `failure ${sessionId}`)

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

  it.each([
    ['no ruling yet', [], { proposed: 3, capped: 1 }],
    ['three rejections', ['rejected'], { proposed: 1, capped: 3 }],
  ])(
    'moves the cap only on proposals someone ruled on (%s)',
    async (_label, rulings, counts) => {
      await seedSessions([3, 3, 3, 3])
      const earlier = parseISO('2026-11-10T09:30:00.000Z').toISOString()
      const lines = ['a', 'b', 'c'].flatMap((id) =>
        ['proposed', ...rulings].map((outcome) => ({
          runId: '2026-11-10',
          conversationId: `conv-old-${id}`,
          agentId: 'chief_of_staff',
          outcome,
          caseId: `old-${id}`,
          failureSummary: `old failure ${id}`,
          createdAt: earlier,
        })),
      )
      objects.set(
        `${BUCKET}/ledger/2026-11.jsonl`,
        lines.map((line) => JSON.stringify(line)).join('\n') + '\n',
      )
      draftFor = (sessionId) =>
        newCase(`case-${sessionId.slice(-1)}`, `failure ${sessionId}`)

      await service.jobs.runSchedule('caseScoutNightly')

      expect(record().counts).toMatchObject(counts)
    },
  )

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

  it('gates a needs-setup line and withholds one that fails', async () => {
    await seedSessions([3, 3])
    const needsSetup = (what: string) =>
      JSON.stringify({ outcome: 'needsSetup', failureSummary: 'f', what })
    draftFor = (sessionId) =>
      sessionId.startsWith('conv-sev-0')
        ? needsSetup("An account like Robin Vale's, with a recount pending.")
        : needsSetup('An account with a recount pending.')

    await service.jobs.runSchedule('caseScoutNightly')

    expect(
      ledgerLines().map((l) => [l.outcome, l.gateFailures, l.needsSetup]),
    ).toEqual([
      ['needsSetup', ['denylist'], WITHHELD_NEEDS_SETUP],
      ['needsSetup', [], 'An account with a recount pending.'],
    ])
    expect(bundle().needsSetup.map((n) => n.what)).toEqual([
      WITHHELD_NEEDS_SETUP,
      'An account with a recount pending.',
    ])
    expect(
      service.app.get(CaseScoutModelService).secondRead,
    ).toHaveBeenCalledTimes(1)
    expect(record().spendUsd.gate).toBe(2 * 0.75)
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
    expect(notes).toHaveLength(1)
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
    expect(marker().updatedByRun).toBe(RUN_ID)
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
})

describe('the handoff to Delegate', () => {
  const draftOne = async (caseId = 'once-only') => {
    await seedConversation({ id: 'conv-ho', scope: ChatScope.chief_of_staff })
    await seedMessage(
      'conv-ho',
      'msg-ho',
      ChatMessageRole.user,
      '2026-11-15T10:00:00.000Z',
      'A question.',
    )
    scoreFor = () => scored(3)
    draftFor = () => newCase(caseId, 'one failure')
  }

  it('signs and posts exactly the held payload, once', async () => {
    sendToDelegate()
    await draftOne()

    await service.jobs.runSchedule('caseScoutNightly')

    expect(requests).toHaveLength(1)
    const [{ headers, body }] = requests as [WebhookRequest]
    expect(body).toBe(bucketJson(`runs/${RUN_ID}/handoff.json`))
    expect(CaseScoutHandoffSchema.parse(JSON.parse(body)).cases).toHaveLength(1)
    expect(headers['content-type']).toBe('application/json')
    expect(headers['webhook-id']).toBe(`case-scout-dev-${RUN_ID}`)
    expect(headers['webhook-timestamp']).toBe(String(getUnixTime(NOW)))
    // Standard Webhooks: base64 HMAC-SHA256 of "id.timestamp.body", keyed by
    // the secret's base64 part.
    const expected = createHmac('sha256', WEBHOOK_KEY)
      .update(
        `${headers['webhook-id']}.${headers['webhook-timestamp']}.${body}`,
      )
      .digest('base64')
    expect(headers['webhook-signature']).toBe(`v1,${expected}`)

    expect(
      DeliverySchema.parse(
        JSON.parse(bucketJson(`runs/${RUN_ID}/delivery.json`) ?? '{}'),
      ),
    ).toMatchObject({ webhookId: `case-scout-dev-${RUN_ID}`, status: 204 })
    expect(marker().updatedByRun).toBe(RUN_ID)
    expect(notes[0]?.text).toContain(
      `Handoff: sent to Delegate (webhook-id case-scout-dev-${RUN_ID})`,
    )
  })

  it('fails the job on a refused post and leaves the marker', async () => {
    sendToDelegate()
    await draftOne()
    webhookStatus = () => 500

    const { deadLetters } = await service.jobs.runSchedule('caseScoutNightly', {
      allowDeadLetters: true,
    })

    expect(deadLetters).toEqual([
      expect.objectContaining({
        name: 'caseScoutDraft',
        error: expect.stringContaining('HTTP 500'),
      }),
    ])
    expect(requests.length).toBeGreaterThan(1)
    expect(bucketJson(`runs/${RUN_ID}/delivery.json`)).toBeUndefined()
    expect(bucketJson('marker.json')).toBeUndefined()
    expect(notes).toEqual([])
    // Every attempt after the first reuses the drafted night.
    expect(
      vi.mocked(service.app.get(CaseScoutModelService).draftCase),
    ).toHaveBeenCalledTimes(1)
  })

  it('fails the job when the webhook cannot be reached', async () => {
    sendToDelegate()
    vi.stubEnv('CASE_SCOUT_DELEGATE_WEBHOOK_URL', 'http://127.0.0.1:1/hook')
    await draftOne()

    const { deadLetters } = await service.jobs.runSchedule('caseScoutNightly', {
      allowDeadLetters: true,
    })

    expect(deadLetters.map((d) => d.name)).toEqual(['caseScoutDraft'])
    expect(deadLetters[0]?.error).toContain('could not reach')
    expect(deadLetters[0]?.error).not.toContain('127.0.0.1')
    expect(bucketJson('marker.json')).toBeUndefined()
  })

  it('posts again after a refused post, without redrafting', async () => {
    sendToDelegate()
    await draftOne()
    const statuses = [503, 200]
    webhookStatus = () => statuses.shift() ?? 200

    await service.jobs.runSchedule('caseScoutNightly')

    expect(requests.map((r) => r.headers['webhook-id'])).toEqual([
      `case-scout-dev-${RUN_ID}`,
      `case-scout-dev-${RUN_ID}`,
    ])
    expect(requests[0]?.body).toBe(requests[1]?.body)
    expect(
      vi.mocked(service.app.get(CaseScoutModelService).draftCase),
    ).toHaveBeenCalledTimes(1)
    expect(ledgerLines()).toHaveLength(1)
    expect(marker().updatedByRun).toBe(RUN_ID)
  })

  it('never sends a night twice when a later step fails', async () => {
    sendToDelegate()
    await draftOne()
    const answers = [undefined, 'ok']
    slackAnswer = () => answers.shift()

    await service.jobs.runSchedule('caseScoutNightly')

    expect(requests).toHaveLength(1)
    expect(notes).toHaveLength(2)
    expect(marker().updatedByRun).toBe(RUN_ID)
  })

  it('sends again under the same webhook-id when delivery.json fails', async () => {
    sendToDelegate()
    await draftOne()
    vi.spyOn(
      service.app.get(CaseScoutBucketService),
      'writeDelivery',
    ).mockRejectedValueOnce(new Error('S3 unavailable'))

    await service.jobs.runSchedule('caseScoutNightly')

    // The swarm dedupes on webhook-id, so the second post is harmless.
    expect(requests.map((r) => r.headers['webhook-id'])).toEqual([
      `case-scout-dev-${RUN_ID}`,
      `case-scout-dev-${RUN_ID}`,
    ])
    expect(requests[0]?.body).toBe(requests[1]?.body)
    expect(
      DeliverySchema.parse(
        JSON.parse(bucketJson(`runs/${RUN_ID}/delivery.json`) ?? '{}'),
      ),
    ).toMatchObject({ webhookId: `case-scout-dev-${RUN_ID}` })
    expect(notes).toHaveLength(1)
    expect(marker().updatedByRun).toBe(RUN_ID)
  })

  it('labels a prod night prod and posts its note to the prod digest', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'prod')
    sendToDelegate()
    await draftOne()

    await service.jobs.runSchedule('caseScoutNightly')

    expect(requests).toHaveLength(1)
    const [{ headers, body }] = requests as [WebhookRequest]
    expect(headers['webhook-id']).toBe(`case-scout-prod-${RUN_ID}`)
    expect(CaseScoutHandoffSchema.parse(JSON.parse(body)).environment).toBe(
      'prod',
    )
    // The note names source conversations, so it must reach only the prod
    // digest.
    expect(notes.map((n) => n.channel)).toEqual([
      SlackChannel.productChatsDigest,
    ])
    expect(notes[0]?.text).toContain(
      'FROM gp_api_pg.public.agent_message WHERE conversation_id IN ' +
        "('conv-ho')",
    )
    expect(notes[0]?.text).toContain(
      `Handoff: sent to Delegate (webhook-id case-scout-prod-${RUN_ID})`,
    )
  })

  it('does nothing more once the marker names the night', async () => {
    sendToDelegate()
    await draftOne()
    await service.jobs.runSchedule('caseScoutNightly')
    const draftCalls = vi.mocked(
      service.app.get(CaseScoutModelService).draftCase,
    ).mock.calls.length

    await service.app
      .get(JobsService)
      .sendMany('caseScoutDraft', [{ data: { runId: RUN_ID }, key: RUN_ID }])
    await service.jobs.settle()

    expect(requests).toHaveLength(1)
    expect(notes).toHaveLength(1)
    expect(
      vi.mocked(service.app.get(CaseScoutModelService).draftCase).mock.calls,
    ).toHaveLength(draftCalls)
  })

  it('carries no source id and none of the ungated fields', async () => {
    sendToDelegate()
    await seedSessions([3, 3])
    draftFor = (sessionId) =>
      sessionId.startsWith('conv-sev-0')
        ? newCase('clean-case', `the drafter named ${sessionId}`)
        : JSON.stringify({
            outcome: 'needsSetup',
            failureSummary: `needs setup, from ${sessionId}`,
            what: 'An account with a recount pending.',
          })

    await service.jobs.runSchedule('caseScoutNightly')

    const [{ body }] = requests as [WebhookRequest]
    // The planted ids are in the night's own files, never in the payload.
    expect(bucketJson(`ledger/${RUN_ID.slice(0, 7)}.jsonl`)).toContain(
      'the drafter named conv-sev-0-3:msg-sev-0',
    )
    for (const id of manifestIds()) expect(body).not.toContain(id)
    expect(body).not.toContain('the drafter named')
    expect(body).not.toContain('needs setup, from')
    expect(Object.keys(JSON.parse(body)).sort()).toEqual([
      'cases',
      'environment',
      'needsSetup',
      'runId',
      'version',
    ])
  })

  it('refuses a night whose draft names its source conversation', async () => {
    sendToDelegate()
    await draftOne()
    draftFor = () =>
      JSON.stringify({
        outcome: 'newCase',
        failureSummary: 'f',
        case: {
          caseId: 'names-its-source',
          question: 'What did we say in conv-ho yesterday?',
          condition: 'A condition.',
          handledWhen: 'A handled-when.',
        },
      })

    const { deadLetters } = await service.jobs.runSchedule('caseScoutNightly', {
      allowDeadLetters: true,
    })

    expect(deadLetters[0]?.error).toContain('names a source id')
    expect(bucketJson(`runs/${RUN_ID}/handoff.json`)).toBeUndefined()
    expect(requests).toEqual([])
    expect(bucketJson('marker.json')).toBeUndefined()
  })
})
