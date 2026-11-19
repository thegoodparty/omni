import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import axios from 'axios'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createArmContext, probeArm } from './arm'
import type { TestUser } from '@goodparty_org/test-users'

// A real HTTP server standing in for one arm's gp-api: the two agent routes, the
// org-scoped route a suite would call, and the readiness page `probeArm` reads.

type RecordedRequest = {
  method: string
  url: string
  headers: Record<string, string | string[] | undefined>
  body: string
}

const startArm = async (): Promise<{
  server: Server
  baseUrl: string
  requests: RecordedRequest[]
  pollsBeforeComplete: number
}> => {
  const requests: RecordedRequest[] = []
  const pollsBeforeComplete = 2
  let polls = 0
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      requests.push({
        method: request.method ?? '',
        url: request.url ?? '',
        headers: request.headers,
        body,
      })
      if (request.url === '/') {
        response.writeHead(200).end('ok')
        return
      }
      if (
        request.method === 'POST' &&
        request.url === '/api/v1/agents/a/runs'
      ) {
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ runId: 'run-1' }))
        return
      }
      if (request.url === '/api/v1/agents/runs/run-1') {
        polls += 1
        response.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify(
            polls <= pollsBeforeComplete
              ? { status: polls === 1 ? 'queued' : 'running' }
              : {
                  status: 'completed',
                  artifact: { summary: 'done' },
                  error: null,
                },
          ),
        )
        return
      }
      if (request.url === '/api/v1/campaigns/mine') {
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ id: 7 }))
        return
      }
      response.writeHead(404).end('not found')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    pollsBeforeComplete,
  }
}

const fakeUser = (baseUrl: string): TestUser => ({
  user: {
    id: 1,
    firstName: 'Test',
    lastName: 'User',
    email: 'test-1+clerk_test@test.goodparty.org',
    name: 'Test User',
    zip: '82001',
    phone: '2015550100',
    password: 'p',
  },
  token: 'token-1',
  client: axios.create({
    baseURL: `${baseUrl}/api`,
    headers: { common: { Authorization: 'Bearer token-1' } },
  }),
  clerkUserId: 'clerk-1',
  orgSlug: 'campaign-7',
  campaignId: 7,
})

describe('createArmContext', () => {
  let arm: Awaited<ReturnType<typeof startArm>>

  beforeAll(async () => {
    arm = await startArm()
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => arm.server.close(() => resolve()))
  })

  it('drives a real agent run through the two routes', async () => {
    const { ctx } = await createArmContext({
      arm: 'candidate',
      baseUrl: arm.baseUrl,
      mode: 'win',
      profile: {
        race: { zip: '82001', office: 'Cheyenne City Council - Ward 1' },
      },
      provisionUser: async () => fakeUser(arm.baseUrl),
      pollIntervalMs: 1,
    })
    const result = await ctx.runAgent('a', { topic: 'x' })
    expect(result).toEqual({
      runId: 'run-1',
      status: 'completed',
      artifact: { summary: 'done' },
      error: null,
    })
    const posted = arm.requests.find((request) =>
      request.url.startsWith('/api/v1/agents/a/runs'),
    )
    expect(posted?.body).toBe(JSON.stringify({ input: { topic: 'x' } }))
    // Three polls: queued, running, completed.
    expect(
      arm.requests.filter(
        (request) => request.url === '/api/v1/agents/runs/run-1',
      ),
    ).toHaveLength(3)
  })

  it('scopes every request to the org bootstrap created', async () => {
    const { ctx } = await createArmContext({
      arm: 'base',
      baseUrl: arm.baseUrl,
      mode: 'win',
      profile: {},
      provisionUser: async () => fakeUser(arm.baseUrl),
    })
    expect(ctx.org.slug).toBe('campaign-7')
    await ctx.api.get('/v1/campaigns/mine')
    const call = arm.requests.find(
      (request) => request.url === '/api/v1/campaigns/mine',
    )
    expect(call?.headers['x-organization-slug']).toBe('campaign-7')
    expect(call?.headers.authorization).toBe('Bearer token-1')
  })

  it('hands the arm URL to the context', async () => {
    const { ctx } = await createArmContext({
      arm: 'candidate',
      baseUrl: arm.baseUrl,
      mode: 'win',
      profile: {},
      provisionUser: async () => fakeUser(arm.baseUrl),
    })
    expect(ctx.baseUrl).toBe(arm.baseUrl)
  })

  it('passes the profile and mode through to provisioning', async () => {
    const seen: unknown[] = []
    await createArmContext({
      arm: 'base',
      baseUrl: arm.baseUrl,
      mode: 'serve',
      profile: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        positionId: 'pos-1',
        termStartDate: '2023-01-01',
        termEndDate: '2027-01-01',
      },
      provisionUser: async (options) => {
        seen.push(options)
        return fakeUser(arm.baseUrl)
      },
    })
    expect(seen[0]).toMatchObject({
      product: 'serve',
      apiBaseUrl: arm.baseUrl,
      firstName: 'Ada',
      lastName: 'Lovelace',
      positionId: 'pos-1',
      termStartDate: '2023-01-01',
      termEndDate: '2027-01-01',
    })
  })
})

describe('probeArm', () => {
  it('reports a reachable arm', async () => {
    const arm = await startArm()
    const result = await probeArm(arm.baseUrl)
    await new Promise<void>((resolve) => arm.server.close(() => resolve()))
    expect(result.ok).toBe(true)
  })

  it('reports an unreachable arm with its error', async () => {
    const result = await probeArm('http://127.0.0.1:1')
    expect(result.ok).toBe(false)
    expect(result.detail).not.toBe('')
  })
})
