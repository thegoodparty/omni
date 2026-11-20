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
      // A webapp root: gp-api is proxied at /api, and the origin's own /v1 is
      // not what this arm serves. resolveApiRoot tells the two apart by that.
      if (request.url === '/api/v1/version') {
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
      // A chat turn: the arm answers with the raw event stream, which is what
      // the client has to hand back untouched, whatever the content type says.
      if (
        request.method === 'POST' &&
        request.url ===
          '/api/v1/chats/conversation-1/messages?scope=chief_of_staff'
      ) {
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end('data: {"type":"done"}\n\n')
        return
      }
      // The preflight's own probe: a run id that cannot exist, answered the way
      // a live arm answers one — the route is there, the run is not.
      if (request.url?.startsWith('/api/v1/agents/runs/')) {
        response
          .writeHead(404, { 'content-type': 'application/json' })
          .end(JSON.stringify({ message: 'no run' }))
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

const serve404 = async (): Promise<{ server: Server; baseUrl: string }> => {
  const server = createServer((_request, response) => {
    response.writeHead(404).end('no api here')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { server, baseUrl: `http://127.0.0.1:${port}` }
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

  it('reads a chat turn as the raw stream text', async () => {
    const { ctx } = await createArmContext({
      arm: 'base',
      baseUrl: arm.baseUrl,
      mode: 'serve',
      profile: {},
      provisionUser: async () => fakeUser(arm.baseUrl),
    })
    // The reply is the event stream itself, so the whole body comes back as
    // text for the SSE parser, with no JSON layer over it.
    const body = await ctx.postEventStream(
      '/v1/chats/conversation-1/messages?scope=chief_of_staff',
      { content: 'hi' },
    )
    expect(body).toBe('data: {"type":"done"}\n\n')
    const call = arm.requests.find((request) =>
      request.url.startsWith('/api/v1/chats/conversation-1/messages'),
    )
    expect(call?.body).toBe(JSON.stringify({ content: 'hi' }))
    expect(call?.headers.accept).toBe('text/event-stream')
    expect(call?.headers['x-organization-slug']).toBe('campaign-7')
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
      apiRoot: `${arm.baseUrl}/api`,
      firstName: 'Ada',
      lastName: 'Lovelace',
      positionId: 'pos-1',
      termStartDate: '2023-01-01',
      termEndDate: '2027-01-01',
    })
  })
})

// An arm whose `/v1/version` is fine but whose routes are not: what a preview
// serving a commit from before the run routes existed looks like.
const startArmWithoutRunRoutes = async (
  status: number,
  body: (url: string) => unknown,
): Promise<{ server: Server; baseUrl: string }> => {
  const server = createServer((request, response) => {
    if (request.url === '/v1/version') {
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ commit: 'test' }))
      return
    }
    response
      .writeHead(status, { 'content-type': 'application/json' })
      .end(JSON.stringify(body(request.url ?? '')))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { server, baseUrl: `http://127.0.0.1:${port}` }
}

describe('probeArm', () => {
  it('reports a reachable arm', async () => {
    const arm = await startArm()
    const result = await probeArm(arm.baseUrl)
    await new Promise<void>((resolve) => arm.server.close(() => resolve()))
    expect(result.ok).toBe(true)
  })

  it('reads a webapp arm through its /api proxy, not its login page', async () => {
    // A webapp answers a bare /v1/... with a redirect to /login, which is a 200
    // of HTML: not an answer about the route. The API answers under /api.
    const server = createServer((request, response) => {
      if (request.url === '/api/v1/version') {
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ commit: 'test' }))
        return
      }
      if (request.url?.startsWith('/api/v1/agents/runs/')) {
        response
          .writeHead(401, { 'content-type': 'application/json' })
          .end(JSON.stringify({ message: 'Unauthorized' }))
        return
      }
      response
        .writeHead(200, { 'content-type': 'text/html' })
        .end('<html>sign in</html>')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    const result = await probeArm(`http://127.0.0.1:${port}`)
    await new Promise<void>((resolve) => server.close(() => resolve()))
    expect(result.ok).toBe(true)
    expect(result.detail).toContain('/api/v1/agents/runs/')
  })

  it('accepts an arm whose run route answers 401 without a session', async () => {
    // The route is there and its guard answered; that is all the probe asks.
    const arm = await startArmWithoutRunRoutes(401, () => ({
      message: 'Unauthorized',
    }))
    const result = await probeArm(arm.baseUrl)
    await new Promise<void>((resolve) => arm.server.close(() => resolve()))
    expect(result.ok).toBe(true)
  })

  it('refuses an arm whose run route does not exist', async () => {
    const arm = await startArmWithoutRunRoutes(404, (url) => ({
      message: `Cannot GET ${url}`,
    }))
    const result = await probeArm(arm.baseUrl)
    await new Promise<void>((resolve) => arm.server.close(() => resolve()))
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('may not have the run routes deployed')
  })

  it('refuses an arm that answers the probe with something else entirely', async () => {
    const arm = await startArmWithoutRunRoutes(500, () => ({
      message: 'boom',
    }))
    const result = await probeArm(arm.baseUrl)
    await new Promise<void>((resolve) => arm.server.close(() => resolve()))
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('500')
  })

  it('reports an arm whose API answers 404 as not reachable', async () => {
    const arm = await serve404()
    const result = await probeArm(arm.baseUrl)
    await new Promise<void>((resolve) => arm.server.close(() => resolve()))
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('404')
  })

  it('reports an unreachable arm with its error', async () => {
    const result = await probeArm('http://127.0.0.1:1')
    expect(result.ok).toBe(false)
    expect(result.detail).not.toBe('')
  })
})
