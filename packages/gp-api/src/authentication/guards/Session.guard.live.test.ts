import { describe, expect, it, vi } from 'vitest'
import jwt from 'jsonwebtoken'
import { TEST_CLERK_ID, useTestService } from '@/test-service'
import { SessionsService } from '@/users/services/sessions.service'

const service = useTestService()

const MCP_ACCEPT = 'application/json, text/event-stream'

// Broker-signed agent tokens are how an AI agent acts on a user's behalf via
// MCP. Mirrors the fixture in mcpServer.service.live.test.ts.
const signAgentToken = (clerkUserId: string) =>
  jwt.sign(
    { act: { sub: 'user_agent_fleet' }, run_id: 'test-run' },
    process.env.AGENT_MCP_TOKEN_SECRET as string,
    {
      issuer: 'gp-broker',
      audience: 'gp-api',
      subject: clerkUserId,
      expiresIn: 120,
    },
  )

describe('SessionGuard — agent tokens do not bump activity tracking', () => {
  it('does not call trackSession for an agent-token request', async () => {
    const trackSpy = vi.spyOn(service.app.get(SessionsService), 'trackSession')

    const res = await service.client.post(
      '/v1/mcp',
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      {
        headers: {
          Accept: MCP_ACCEPT,
          Authorization: `Bearer ${signAgentToken(TEST_CLERK_ID)}`,
        },
      },
    )

    expect(res.status).toBe(200)
    expect(trackSpy).not.toHaveBeenCalled()
  })

  it('calls trackSession for a normal session-token request', async () => {
    const trackSpy = vi.spyOn(service.app.get(SessionsService), 'trackSession')

    const res = await service.client.post(
      '/v1/mcp',
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      { headers: { Accept: MCP_ACCEPT } },
    )

    expect(res.status).toBe(200)
    expect(trackSpy).toHaveBeenCalledTimes(1)
  })
})
