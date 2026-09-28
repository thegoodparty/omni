/**
 * Zero-cost proof that the bench drives the real Campaign Manager wiring:
 * prints what the handler actually produced at whichever commit is checked
 * out. No model calls. Untracked pilot file.
 */
import { describe, it } from 'vitest'
import { execSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { ForbiddenException } from '@nestjs/common'
import type { Organization } from '../../../../generated/prisma'
import type { CampaignsService } from '@/campaigns/services/campaigns.service'
import type { ChatStoreService } from '@/chats/services/chatStore.prisma'
import {
  PRO_FEATURE_REQUIRED_MESSAGE,
  PRO_FILTERING_REQUIRED_MESSAGE,
  type ContactsService,
} from '@/contacts/services/contacts.service'
import type { FilterDimension } from '@/contacts/filterDimensions.catalog'
import {
  FILTER_PRO_REQUIRED_MESSAGE,
  type VoterFileFilterService,
} from '@/voters/services/voterFileFilter.service'
import type { GeneralChatStoreService } from '../../services/generalChatStore.prisma'
import type { HelpCenterSearchService } from '../../help-center/helpCenterSearch.service'
import { CampaignManagerHandler } from '../campaignManager.handler'
import { WIN_CONSTITUENT_TABLES } from '../services/constituentDataScope'

const ORG = { slug: 'campaign-eval' } as Organization

const DIMENSIONS: FilterDimension[] = [
  {
    key: 'turnout',
    label: 'Turnout likelihood',
    kind: 'boolean-group',
    modes: 'both',
    provenance: 'modeled',
    values: [{ key: 'audienceLikelyVoters', label: 'Likely voters' }],
  },
]

const buildHandler = (pro: boolean): CampaignManagerHandler => {
  const gated = <T>(value: T, message: string): Promise<T> =>
    pro
      ? Promise.resolve(value)
      : Promise.reject(new ForbiddenException(message))
  return new CampaignManagerHandler(
    {
      findFirst: () =>
        Promise.resolve({ id: 'conv-1', organizationSlug: ORG.slug }),
    } as unknown as GeneralChatStoreService,
    {
      client: {
        campaign: {
          findFirst: () =>
            Promise.resolve({
              id: 1,
              organizationSlug: ORG.slug,
              isPro: pro,
              ballotStatus: 'on-ballot',
              details: {
                normalizedOffice: 'City Council',
                district: 'Ward 3',
                ballotLevel: 'city',
                city: 'Springfield',
                state: 'IL',
              },
              data: {},
              user: { firstName: 'Renee', lastName: 'Diaz' },
            }),
        },
        campaignTrackerTask: { findMany: () => Promise.resolve([]) },
        organization: { findFirst: () => Promise.resolve(ORG) },
      },
    } as unknown as CampaignsService,
    {} as ChatStoreService,
    WIN_CONSTITUENT_TABLES,
    undefined,
    undefined,
    undefined,
    {
      getFilterDimensions: () => DIMENSIONS,
      countContacts: () =>
        gated({ count: 1234 }, PRO_FILTERING_REQUIRED_MESSAGE),
      getPrecincts: () =>
        gated({ options: [], truncated: false }, PRO_FEATURE_REQUIRED_MESSAGE),
      countSegment: () => gated({ count: 0 }, PRO_FILTERING_REQUIRED_MESSAGE),
    } as unknown as ContactsService,
    {
      findByOrganizationSlug: () => Promise.resolve([]),
      filterAccessCheck: () => gated(undefined, FILTER_PRO_REQUIRED_MESSAGE),
      findByIdAndOrganizationSlug: () => Promise.resolve(null),
      create: () => Promise.resolve(null),
      updateByIdAndOrganizationSlug: () => Promise.resolve(null),
      deleteByIdAndOrganizationSlug: () => Promise.resolve(null),
    } as unknown as VoterFileFilterService,
    undefined,
    {
      search: () => Promise.resolve({ articles: [] }),
    } as unknown as HelpCenterSearchService,
  )
}

// A diagnostic, not an assertion. Gated so it stays out of the normal suite.
const d = process.env.RUN_WIRING_CHECK === '1' ? describe : describe.skip

d('wiring at the checked-out commit', () => {
  it('reports what the real handler produced', async () => {
    const sha = execSync('git rev-parse --short HEAD').toString().trim()
    const lines: string[] = [`commit: ${sha}`]
    for (const pro of [false, true]) {
      const handler = buildHandler(pro)
      const ctx = await handler.loadContext('conv-1', 1)
      const prompt = handler.buildSystemPrompt(ctx)
      const tools = Object.keys(handler.buildTools(ctx)).sort()
      lines.push(
        `\n--- isPro=${pro} ---`,
        `ctx.isPro: ${JSON.stringify(
          (ctx as unknown as { isPro?: boolean }).isPro,
        )}`,
        `prompt chars: ${prompt.length}`,
        `prompt mentions "Pro": ${/\bPro\b/.test(prompt)}`,
        `prompt mentions candidate name: ${/Renee/.test(prompt)}`,
        `tools registered (${tools.length}): ${tools.join(', ')}`,
      )
    }
    // vitest swallows console output from passing tests.
    writeFileSync(`/tmp/wiring-${sha}.txt`, lines.join('\n'))
  }, 60000)
})
