import { NotFoundException } from '@nestjs/common'
import { z } from 'zod'
import type { AgentTool } from '@/agents/tools/tool'
import { CommunityIssueReadService } from '@/communityIssues/services/communityIssueRead.service'
import { PrioritiesService } from '@/priorities/services/priorities.service'
import { PrismaService } from '@/prisma/prisma.service'

const input = z.object({})

export const officialPriorities: AgentTool<typeof input> = {
  name: 'officialPriorities',
  description:
    "The official's active priorities and their community issues (top community and trending). Use them to pick which agenda items to feature and to stamp priority_id or community_issue_id.",
  input,
  execute: async (_request, ctx) => {
    const office = await ctx.moduleRef
      .get(PrismaService, { strict: false })
      .electedOffice.findFirst({
        where: { organizationSlug: ctx.organizationSlug },
        select: { id: true },
      })
    if (!office) {
      throw new NotFoundException(
        `no elected office for organization ${ctx.organizationSlug}`,
      )
    }
    const reads = ctx.moduleRef.get(CommunityIssueReadService, {
      strict: false,
    })
    const [priorities, top, trending] = await Promise.all([
      ctx.moduleRef
        .get(PrioritiesService, { strict: false })
        .listActive(office.id),
      reads.listForOrg(ctx.organizationSlug, office.id, 'top_community'),
      reads.listForOrg(ctx.organizationSlug, office.id, 'trending'),
    ])
    return {
      priorities: priorities.map(({ id, title, description }) => ({
        id,
        title,
        description,
      })),
      communityIssues: [...top.issues, ...trending.issues].map(
        ({ id, title, summary, list, category }) => ({
          id,
          title,
          summary,
          list,
          category,
        }),
      ),
    }
  },
}
