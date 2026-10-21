import { RequestMethod } from '@nestjs/common'
import { METHOD_METADATA } from '@nestjs/common/constants'
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core'
import { parseISO } from 'date-fns'
import jwt from 'jsonwebtoken'
import { describe, expect, it, vi } from 'vitest'
import {
  REQUIRE_CAMPAIGN_META_KEY,
  type RequireCampaignMetadata,
} from '@/campaigns/decorators/UseCampaign.decorator'
import { REQUIRE_ELECTED_OFFICE_META_KEY } from '@/electedOffice/decorators/UseElectedOffice.decorator'
import { MCP_TOOL_KEY } from '@/mcp/decorators/McpTool.decorator'
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

  // Every field the plan sets lands as planned, not just the row ids.
  it('writes every planned field', async () => {
    await seedJudgeFixture(service.prisma)
    const rows = await snapshot()
    expect(rows.user).toMatchObject(plan.user)
    expect(rows.org).toMatchObject(plan.organization)
    expect(rows.office).toMatchObject(plan.electedOffice)
    expect(rows.org?.ownerId).toBe(rows.user?.id)
    expect(rows.office?.userId).toBe(rows.user?.id)
    for (const priority of plan.priorities) {
      expect(rows.priorities.find((p) => p.id === priority.id)).toMatchObject({
        ...priority,
        electedOfficeId: rows.office?.id,
      })
    }
    for (const issue of plan.communityIssues) {
      expect(rows.issues.find((i) => i.id === issue.id)).toMatchObject(issue)
    }
  })

  it('runs in one transaction with room for a remote cluster', async () => {
    const spy = vi.spyOn(service.prisma, '$transaction')
    await seedJudgeFixture(service.prisma)
    expect(spy).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 30_000,
      maxWait: 10_000,
    })
    spy.mockRestore()
  })

  const [firstPriority] = plan.priorities
  it.each([
    {
      label: `organization ${JUDGE_FIXTURE.orgSlug}`,
      drift: () =>
        service.prisma.organization.update({
          where: { slug: JUDGE_FIXTURE.orgSlug },
          data: { customPositionName: 'Mayor' },
        }),
      read: async () =>
        (
          await service.prisma.organization.findUnique({
            where: { slug: JUDGE_FIXTURE.orgSlug },
          })
        )?.customPositionName,
      planned: plan.organization.customPositionName,
    },
    {
      label: `elected office on ${JUDGE_FIXTURE.orgSlug}`,
      drift: () =>
        service.prisma.electedOffice.update({
          where: { organizationSlug: JUDGE_FIXTURE.orgSlug },
          data: { termEndDate: parseISO('2031-01-01T00:00:00Z') },
        }),
      read: async () =>
        (
          await service.prisma.electedOffice.findUnique({
            where: { organizationSlug: JUDGE_FIXTURE.orgSlug },
          })
        )?.termEndDate,
      planned: plan.electedOffice.termEndDate,
    },
    {
      label: `priority ${firstPriority?.id}`,
      drift: () =>
        service.prisma.priority.update({
          where: { id: firstPriority?.id },
          data: { archivedAt: new Date() },
        }),
      read: async () =>
        (
          await service.prisma.priority.findUnique({
            where: { id: firstPriority?.id },
          })
        )?.archivedAt,
      planned: null,
    },
  ])('puts back a changed field on $label, and only that row', async (c) => {
    await seedJudgeFixture(service.prisma)
    await c.drift()

    const report = await seedJudgeFixture(service.prisma)
    expect(report.updated).toEqual([c.label])
    expect(await c.read()).toEqual(c.planned)
  })

  describe('refuses a row it does not own', () => {
    const otherUser = (suffix: string, email?: string) =>
      service.prisma.user.create({
        data: {
          email: email ?? `other-${suffix}@example.com`,
          clerkId: `user_other_${suffix}`,
        },
      })

    it('the fixture email under another clerk id', async () => {
      await otherUser('email', JUDGE_FIXTURE.email)
      await expect(seedJudgeFixture(service.prisma)).rejects.toThrow(
        /under another clerk id/,
      )
    })

    it('an elected office on the fixture slug owned by another user', async () => {
      await seedJudgeFixture(service.prisma)
      const other = await otherUser('office')
      await service.prisma.electedOffice.update({
        where: { organizationSlug: JUDGE_FIXTURE.orgSlug },
        data: { userId: other.id },
      })
      await expect(seedJudgeFixture(service.prisma)).rejects.toThrow(
        /belongs to user/,
      )
    })

    it('a planned priority id on another elected office', async () => {
      await service.prisma.organization.create({
        data: { slug: 'judge-other-office', ownerId: service.user.id },
      })
      const office = await service.prisma.electedOffice.create({
        data: {
          organizationSlug: 'judge-other-office',
          userId: service.user.id,
        },
      })
      await service.prisma.priority.create({
        data: {
          id: firstPriority?.id,
          electedOfficeId: office.id,
          title: 'not ours',
          description: 'not ours',
          source: 'user_stated',
        },
      })
      await expect(seedJudgeFixture(service.prisma)).rejects.toThrow(
        /another elected office/,
      )
    })

    it('a planned issue id on another organization', async () => {
      const [issue] = plan.communityIssues
      await service.prisma.organization.create({
        data: { slug: 'judge-other-org', ownerId: service.user.id },
      })
      await service.prisma.communityIssue.create({
        data: {
          ...issue,
          id: issue?.id,
          list: issue?.list ?? 'trending',
          category: issue?.category ?? 'other',
          priority: issue?.priority ?? 'low',
          title: 'not ours',
          summary: 'not ours',
          organizationSlug: 'judge-other-org',
        },
      })
      await expect(seedJudgeFixture(service.prisma)).rejects.toThrow(
        /another organization/,
      )
    })
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

  // THE FIXTURE'S SAFETY RESTS ON THIS. A judge run reaches every @McpTool as
  // the fixture account, which owns an elected office and no campaign. So an
  // office-scoped tool must not write, and every tool that writes must need a
  // campaign, which the fixture never has.
  describe('the MCP tools a fixture run can reach', () => {
    const tools = () => {
      const discovery = service.app.get(DiscoveryService)
      const scanner = service.app.get(MetadataScanner)
      const reflector = service.app.get(Reflector)
      return discovery.getControllers().flatMap(({ instance, metatype }) => {
        if (!instance || !metatype) return []
        const proto = Object.getPrototypeOf(instance)
        return scanner
          .getAllMethodNames(proto)
          .filter((name) => reflector.get(MCP_TOOL_KEY, proto[name]))
          .map((name) => {
            const targets = [proto[name], metatype]
            return {
              name: `${metatype.name}.${name}`,
              method: Reflect.getMetadata(METHOD_METADATA, proto[name]),
              office: reflector.getAllAndOverride(
                REQUIRE_ELECTED_OFFICE_META_KEY,
                targets,
              ),
              campaign: reflector.getAllAndOverride<RequireCampaignMetadata>(
                REQUIRE_CAMPAIGN_META_KEY,
                targets,
              ),
            }
          })
      })
    }

    it('finds the tools, including the ones the three agents call', () => {
      const names = tools().map((t) => t.name)
      expect(names).toEqual(
        expect.arrayContaining([
          'CommunityIssuesController.list',
          'PrioritiesController.list',
        ]),
      )
    })

    it('makes every office-scoped tool a GET', () => {
      const writes = tools().filter(
        (t) => t.office !== undefined && t.method !== RequestMethod.GET,
      )
      expect(writes.map((t) => t.name)).toEqual([])
    })

    it('makes every tool that writes need a campaign', () => {
      const unguarded = tools().filter(
        (t) =>
          t.method !== RequestMethod.GET &&
          (t.campaign === undefined || t.campaign.continueIfNotFound === true),
      )
      expect(unguarded.map((t) => t.name)).toEqual([])
    })
  })
})
