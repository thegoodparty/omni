import jwt from 'jsonwebtoken'
import { describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'
import { JUDGE_FIXTURE } from './judgeFixtureIdentity'
import { judgeFixturePlan, seedJudgeFixture } from './judgeFixtureSeed'

const MCP_ACCEPT = 'application/json, text/event-stream'

describe('seedJudgeFixture against the database', () => {
  const service = useTestService()
  const plan = judgeFixturePlan()
  const rowCount = 3 + plan.priorities.length + plan.communityIssues.length

  const snapshot = async () => ({
    user: await service.prisma.user.findUnique({
      where: { clerkId: JUDGE_FIXTURE.clerkUserId },
    }),
    org: await service.prisma.organization.findUnique({
      where: { slug: JUDGE_FIXTURE.orgSlug },
    }),
    office: await service.prisma.electedOffice.findUnique({
      where: { organizationSlug: JUDGE_FIXTURE.orgSlug },
    }),
    priorities: await service.prisma.priority.findMany({
      orderBy: { id: 'asc' },
    }),
    issues: await service.prisma.communityIssue.findMany({
      orderBy: { id: 'asc' },
    }),
  })

  it('creates every row once, and a second run writes nothing', async () => {
    const first = await seedJudgeFixture(service.prisma)
    expect(first.created).toHaveLength(rowCount)
    expect(first.updated).toEqual([])
    const before = await snapshot()

    const second = await seedJudgeFixture(service.prisma)
    expect(second.created).toEqual([])
    expect(second.updated).toEqual([])
    expect(second.unchanged).toHaveLength(rowCount)
    // updatedAt included: an upsert that rewrote the same values would still
    // move it.
    expect(await snapshot()).toEqual(before)
  })

  it('puts back a field someone changed, and only that row', async () => {
    await seedJudgeFixture(service.prisma)
    const [first] = plan.priorities
    await service.prisma.priority.update({
      where: { id: first?.id },
      data: { archivedAt: new Date() },
    })

    const report = await seedJudgeFixture(service.prisma)
    expect(report.updated).toEqual([`priority ${first?.id}`])
    expect(
      (await service.prisma.priority.findUnique({ where: { id: first?.id } }))
        ?.archivedAt,
    ).toBeNull()
  })

  it('refuses an organization slug someone else owns', async () => {
    await service.prisma.organization.create({
      data: { slug: JUDGE_FIXTURE.orgSlug, ownerId: service.user.id },
    })
    await expect(seedJudgeFixture(service.prisma)).rejects.toThrow(
      /owned by user/,
    )
    // One transaction: the user it created before refusing is gone too.
    expect(
      await service.prisma.user.findUnique({
        where: { clerkId: JUDGE_FIXTURE.clerkUserId },
      }),
    ).toBeNull()
  })

  it('refuses when the organization has a campaign', async () => {
    await seedJudgeFixture(service.prisma)
    const owner = await service.prisma.user.findUniqueOrThrow({
      where: { clerkId: JUDGE_FIXTURE.clerkUserId },
    })
    await service.prisma.campaign.create({
      data: {
        userId: owner.id,
        slug: 'judge-fixture-campaign',
        details: {},
        organizationSlug: JUDGE_FIXTURE.orgSlug,
      },
    })
    await expect(seedJudgeFixture(service.prisma)).rejects.toThrow(
      /has a campaign/,
    )
  })

  // THE PATH A JUDGE RUN TAKES, end to end on the gp-api side: the broker
  // signs a token whose sub is the fixture's clerk id and sends the fixture
  // slug, and the reads the three agents make come back with the seeded rows
  // while a write tool finds no campaign.
  describe('read over MCP as the broker would', () => {
    const agentToken = () =>
      jwt.sign(
        { act: { sub: 'user_agent_fleet' }, run_id: 'judge-fixture-test' },
        process.env.AGENT_MCP_TOKEN_SECRET as string,
        {
          issuer: 'gp-broker',
          audience: 'gp-api',
          subject: JUDGE_FIXTURE.clerkUserId,
          expiresIn: 120,
        },
      )

    const call = async (name: string, args: object) => {
      const res = await service.client.post(
        '/v1/mcp',
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name, arguments: args },
        },
        {
          headers: {
            Accept: MCP_ACCEPT,
            'x-organization-slug': JUDGE_FIXTURE.orgSlug,
            Authorization: `Bearer ${agentToken()}`,
          },
        },
      )
      expect(res.status).toBe(200)
      return res.data.result as {
        isError: boolean
        content: { text: string }[]
      }
    }

    it.each(['top_community', 'trending'])(
      'lists the %s issues',
      async (list) => {
        await seedJudgeFixture(service.prisma)
        const result = await call('GET_community_issues', { query: { list } })
        expect(result.isError).toBe(false)
        const body = JSON.parse(result.content[0]?.text ?? '{}')
        expect(body.issues.map((i: { id: string }) => i.id)).toEqual(
          plan.communityIssues.filter((i) => i.list === list).map((i) => i.id),
        )
      },
    )

    // What meeting_briefing's instruction used to ask for, and why it now
    // names a list.
    it('refuses the issue list without a list', async () => {
      await seedJudgeFixture(service.prisma)
      const result = await call('GET_community_issues', {})
      expect(result.isError).toBe(true)
    })

    it('lists the priorities', async () => {
      await seedJudgeFixture(service.prisma)
      const result = await call('GET_priorities', {})
      expect(result.isError).toBe(false)
      const body = JSON.parse(result.content[0]?.text ?? '[]')
      expect(body.map((p: { id: string }) => p.id).sort()).toEqual(
        plan.priorities.map((p) => p.id).sort(),
      )
    })

    it('finds no campaign for a campaign tool', async () => {
      await seedJudgeFixture(service.prisma)
      const result = await call('GET_campaigns_mine', {})
      expect(result.isError).toBe(true)
      expect(result.content[0]?.text).toMatch(/404/)
    })
  })
})
