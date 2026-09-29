import type { ChatAnchor } from '@goodparty_org/contracts'
import {
  ChatScope,
  OrdinanceSeedType,
  PrioritySource,
  type PrismaClient,
} from '../../../../generated/prisma'
import { assertTestProcess } from './chatSeam'

// The minimum state a chat scope needs before a real turn can be driven
// through the HTTP routes, per scope. Each scope's loadContext throws a 404
// when its own row is missing, so a run against an unseeded database fails as
// an infraError rather than producing anything to judge.
//
// Seeded slugs are derived from the case id rather than randomised. Both arms
// of a comparison must render the SAME system prompt when the branch changed
// nothing the agent can see, and a random slug that reached the prompt would
// make every configDigest differ — permanently disarming the orchestrator's
// refusal to compare two identical configs.

export interface SeededChatOrg {
  organizationSlug: string
  electedOfficeId?: string
  // Present for the two anchor-keyed scopes. POST /v1/chats rejects those
  // without it, so the runner passes whatever the seed produced.
  anchor?: ChatAnchor
}

const CHAT_AGENT_SCOPES: Record<string, ChatScope> = {
  chief_of_staff: ChatScope.chief_of_staff,
  campaign_assistant: ChatScope.campaign_assistant,
  ordinance_flow: ChatScope.ordinance_flow,
  priority_flow: ChatScope.priority_flow,
}

export const chatScopeFor = (agentId: string): ChatScope => {
  const scope = CHAT_AGENT_SCOPES[agentId]
  if (!scope) {
    throw new Error(
      `"${agentId}" is not a chat scope the runner can drive; the four ` +
        `registered scopes are ${Object.keys(CHAT_AGENT_SCOPES).join(', ')}`,
    )
  }
  return scope
}

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)

const snapshotFor = (title: string) => ({
  title,
  summary: `Judge fixture for ${title}.`,
})

// `slugKey` is the caller's case id: unique per case within one run, and the
// same on both arms.
export const seedChatOrg = async (
  prisma: PrismaClient,
  userId: number,
  agentId: string,
  slugKey: string,
): Promise<SeededChatOrg> => {
  // Inserts against whatever client it is handed. Nothing here deletes, but a
  // judge-prefixed organization owned by a real user is still not something
  // to create outside a throwaway database.
  assertTestProcess('seedChatOrg')
  const scope = chatScopeFor(agentId)
  const organizationSlug = `judge-${slugify(`${agentId}-${slugKey}`)}`

  if (scope === ChatScope.campaign_assistant) {
    await prisma.organization.create({
      data: { slug: organizationSlug, ownerId: userId },
    })
    await prisma.campaign.create({
      data: { organizationSlug, slug: organizationSlug, userId },
    })
    return { organizationSlug }
  }

  await prisma.organization.create({
    data: {
      slug: organizationSlug,
      ownerId: userId,
      customPositionName: 'Council Member',
    },
  })
  const electedOffice = await prisma.electedOffice.create({
    data: { organizationSlug, userId },
  })

  if (scope === ChatScope.ordinance_flow) {
    const ordinance = await prisma.ordinance.create({
      data: {
        electedOfficeId: electedOffice.id,
        seedType: OrdinanceSeedType.new,
        goalText: 'Require covered bicycle parking at new multifamily builds.',
      },
    })
    return {
      organizationSlug,
      electedOfficeId: electedOffice.id,
      anchor: {
        resourceType: 'ordinance',
        resourceId: ordinance.id,
        url: `https://goodparty.org/ordinances/${ordinance.slug}`,
        snapshot: snapshotFor('Bicycle parking ordinance'),
        step: 'clarify',
      },
    }
  }

  if (scope === ChatScope.priority_flow) {
    const priority = await prisma.priority.create({
      data: {
        electedOfficeId: electedOffice.id,
        title: 'Affordable housing',
        description: 'Expand the supply of affordable housing downtown.',
        source: PrioritySource.user_stated,
      },
    })
    return {
      organizationSlug,
      electedOfficeId: electedOffice.id,
      anchor: {
        resourceType: 'priority',
        resourceId: priority.id,
        url: `https://goodparty.org/priorities/${priority.id}`,
        snapshot: snapshotFor('Affordable housing'),
      },
    }
  }

  return { organizationSlug, electedOfficeId: electedOffice.id }
}
