import { HttpStatus } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import {
  AUTH_PROVIDER_TOKEN,
  AuthProvider,
} from '@/authentication/interfaces/auth-provider.interface'
import {
  AgentMessageRole,
  AgentRunStatus,
  Prisma,
} from '../../generated/prisma'

const service = useTestService()

const LIST_PATH = '/v1/admin/background-agent-runs'

// SessionGuard only sets req.m2mToken on an mt_ bearer it can verify, and the
// harness otherwise authenticates as a session user.
const asMachine = () =>
  vi
    .spyOn<
      AuthProvider,
      'verifyM2MToken'
    >(service.app.get<AuthProvider>(AUTH_PROVIDER_TOKEN), 'verifyM2MToken')
    .mockResolvedValue({ id: 'mt_test', subject: 'mch_gp_admin' })

const MACHINE_HEADERS = { Authorization: 'Bearer mt_test' }

const seedOrg = (slug: string) =>
  service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })

const createRun = async (
  overrides: Partial<Prisma.AgentRunUncheckedCreateInput> = {},
) => {
  const slug = overrides.organizationSlug ?? `bg-runs-${randomUUID()}`
  if (!overrides.organizationSlug) await seedOrg(slug)
  return service.prisma.agentRun.create({
    data: {
      agentName: 'trending_issues',
      organizationSlug: slug,
      status: AgentRunStatus.completed,
      manifest: { input: {}, output: {} },
      shapeHash: 'shape-1',
      input: { organizationSlug: slug },
      artifact: { trending: [] },
      startedAt: new Date('2026-06-01T00:00:00Z'),
      finishedAt: new Date('2026-06-01T00:02:30Z'),
      ...overrides,
    },
  })
}

describe('GET /v1/admin/background-agent-runs', () => {
  it('rejects a session user with no M2M token', async () => {
    const res = await service.client.get(LIST_PATH)

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
  })

  it('lists a run with its agent, organization, status and duration', async () => {
    asMachine()
    const run = await createRun()

    const res = await service.client.get(LIST_PATH, {
      headers: MACHINE_HEADERS,
    })

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.meta).toEqual({ total: 1, offset: 0, limit: 100 })
    expect(res.data.data).toEqual([
      {
        runId: run.id,
        agentName: 'trending_issues',
        organizationSlug: run.organizationSlug,
        status: AgentRunStatus.completed,
        durationSeconds: 150,
        createdAt: run.createdAt.toISOString(),
      },
    ])
  })

  it('reports a null duration for a run that has not finished', async () => {
    asMachine()
    await createRun({ status: AgentRunStatus.running, finishedAt: null })

    const res = await service.client.get(LIST_PATH, {
      headers: MACHINE_HEADERS,
    })

    expect(res.data.data[0].durationSeconds).toBeNull()
  })

  it('filters by agentName, status, organizationSlug and a created range', async () => {
    asMachine()
    const older = await createRun({
      agentName: 'trending_issues',
      createdAt: new Date('2026-05-01T00:00:00Z'),
    })
    const newer = await createRun({
      agentName: 'case_scout',
      createdAt: new Date('2026-06-01T00:00:00Z'),
    })
    await createRun({
      agentName: 'case_scout',
      status: AgentRunStatus.failed,
      createdAt: new Date('2026-06-02T00:00:00Z'),
    })

    const byAgent = await service.client.get(LIST_PATH, {
      headers: MACHINE_HEADERS,
      params: { agentName: 'trending_issues' },
    })
    expect(
      byAgent.data.data.map((run: { runId: string }) => run.runId),
    ).toEqual([older.id])

    const byStatus = await service.client.get(LIST_PATH, {
      headers: MACHINE_HEADERS,
      params: { status: AgentRunStatus.completed },
    })
    expect(
      byStatus.data.data.map((run: { runId: string }) => run.runId),
    ).toEqual([newer.id, older.id])

    const byOrg = await service.client.get(LIST_PATH, {
      headers: MACHINE_HEADERS,
      params: { organizationSlug: newer.organizationSlug },
    })
    expect(byOrg.data.data.map((run: { runId: string }) => run.runId)).toEqual([
      newer.id,
    ])

    const byRange = await service.client.get(LIST_PATH, {
      headers: MACHINE_HEADERS,
      params: {
        createdAfter: '2026-05-15T00:00:00Z',
        createdBefore: '2026-06-01T12:00:00Z',
      },
    })
    expect(
      byRange.data.data.map((run: { runId: string }) => run.runId),
    ).toEqual([newer.id])
  })

  it('paginates with offset and limit', async () => {
    asMachine()
    const older = await createRun({
      createdAt: new Date('2026-06-01T00:00:00Z'),
    })
    await createRun({ createdAt: new Date('2026-06-02T00:00:00Z') })

    const res = await service.client.get(LIST_PATH, {
      headers: MACHINE_HEADERS,
      params: { limit: 1, offset: 1 },
    })

    expect(res.data.meta).toEqual({ total: 2, offset: 1, limit: 1 })
    expect(res.data.data.map((run: { runId: string }) => run.runId)).toEqual([
      older.id,
    ])
  })
})

describe('GET /v1/admin/background-agent-runs/:runId', () => {
  it('returns the run and its messages in index order', async () => {
    asMachine()
    const run = await createRun({ error: 'the budget ran out' })
    await service.prisma.agentMessage.createMany({
      data: [
        {
          agentRunId: run.id,
          index: 2,
          role: AgentMessageRole.tool,
          parts: [{ type: 'tool-result', toolCallId: 'c1', output: {} }],
        },
        {
          agentRunId: run.id,
          index: 0,
          role: AgentMessageRole.user,
          parts: [{ type: 'text', text: '{"topic":"zoning"}' }],
        },
        {
          agentRunId: run.id,
          index: 1,
          role: AgentMessageRole.assistant,
          parts: [{ type: 'text', text: 'looking it up' }],
          model: 'claude-sonnet-4-6',
          inputTokens: 1000,
          outputTokens: 100,
          cacheReadTokens: 10,
          cacheWriteTokens: 5,
        },
      ],
    })

    const res = await service.client.get(`${LIST_PATH}/${run.id}`, {
      headers: MACHINE_HEADERS,
    })

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toMatchObject({
      runId: run.id,
      agentName: 'trending_issues',
      organizationSlug: run.organizationSlug,
      status: AgentRunStatus.completed,
      input: { organizationSlug: run.organizationSlug },
      artifact: { trending: [] },
      error: 'the budget ran out',
      shapeHash: 'shape-1',
      durationSeconds: 150,
    })
    expect(
      res.data.messages.map((message: { index: number }) => message.index),
    ).toEqual([0, 1, 2])
    expect(res.data.messages[1]).toMatchObject({
      role: AgentMessageRole.assistant,
      model: 'claude-sonnet-4-6',
      inputTokens: 1000,
      outputTokens: 100,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
    })
    expect(res.data.messages[0]).toMatchObject({
      role: AgentMessageRole.user,
      model: null,
      inputTokens: null,
    })
  })

  it('404s a run that does not exist', async () => {
    asMachine()

    const res = await service.client.get(
      `${LIST_PATH}/3f0c1e2a-0000-4000-8000-000000000000`,
      { headers: MACHINE_HEADERS },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})
