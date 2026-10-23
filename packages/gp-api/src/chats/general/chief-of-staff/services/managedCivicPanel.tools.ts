import { addDays, format, parseISO, startOfWeek } from 'date-fns'
import { z } from 'zod'
import {
  managedCivicPanelExplanation,
  managedCivicPanelHowItWorks,
  type ManagedCivicPanel,
} from '@goodparty_org/contracts'
import type { Organization } from '../../../../generated/prisma'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import type { ManagedCivicPanelService } from '@/contacts/services/managedCivicPanel.service'
import { nextManagedSendDate } from '@/outreach/services/outreachServeSmsCreate.service'

export const EXPLAIN_MANAGED_PANEL_TOOL = 'explain_managed_panel'
export const OFFER_MANAGED_PANEL_INVITE_TOOL = 'offer_managed_panel_invite'
export const PRESENT_MANAGED_PANEL_INVITE_TOOL = 'present_managed_panel_invite'
export const READ_MANAGED_PANEL_TOOL = 'read_managed_panel'
export const PRESENT_MANAGED_PANEL_TOOL = 'present_managed_panel'

// The waves run over about two weeks from the first send.
const BUILD_DAYS = 14

// GoodParty builds the panel for the office (the managed panel): the
// official approves one invite and GoodParty texts it in waves. The
// explanation is fixed words the agent writes as they are. The offer, the
// invite and the panel are widgets the app draws from fixed words and the
// enrollment it reads itself; these tools only decide whether they may be
// shown, and read where the panel stands.

const noInput = z.object({})

const explainInput = z.object({
  part: z
    .enum(['what_it_is', 'how_it_works'])
    .describe(
      'what_it_is after they press Build my civic panel or ask to set it ' +
        'up; how_it_works when they ask how it works or who gets texted.',
    ),
})

const offerInput = z.object({
  afterHowItWorks: z
    .boolean()
    .optional()
    .describe('True right after the how_it_works explanation.'),
})

// When the first invites go out and the week the panel should be ready,
// from the day it was approved: the earliest day a Serve text can be sent,
// and about two weeks of waves after it.
export const managedPanelTimeline = (approvedAt: Date) => {
  const firstSend = parseISO(nextManagedSendDate(approvedAt))
  const readyWeek = startOfWeek(addDays(firstSend, BUILD_DAYS), {
    weekStartsOn: 1,
  })
  return {
    firstSendDate: format(firstSend, 'EEEE, MMMM d'),
    readyWeekOf: format(readyWeek, 'MMMM d'),
  }
}

// A stopped enrollment keeps its row, but nothing is being built.
export const isManagedPanelSetUp = (
  panel: ManagedCivicPanel | null | undefined,
): boolean => Boolean(panel) && panel?.status !== 'stopped'

export const buildManagedCivicPanelTools = ({
  panels,
  organization,
  setUp,
}: {
  panels: ManagedCivicPanelService
  organization: Organization
  // Whether the office had approved the panel when the turn started.
  setUp: boolean
}) => {
  const notAgain = {
    error:
      'They already set up their civic panel. Never offer or show the ' +
      `invite again. Call ${READ_MANAGED_PANEL_TOOL} and ` +
      `${PRESENT_MANAGED_PANEL_TOOL} to say where it stands.`,
  }

  const explain: LlmStreamTool<typeof explainInput> = {
    description:
      'The fixed words that explain their civic panel. Write the text it ' +
      'returns as your reply, word for word, with nothing added, changed ' +
      'or left out. Only before they set up their civic panel.',
    inputSchema: explainInput,
    execute: async ({ part }) => {
      if (setUp) return notAgain
      if (part === 'how_it_works') {
        return {
          text: managedCivicPanelHowItWorks(
            await panels.explainerFacts(organization),
          ),
        }
      }
      return {
        text: managedCivicPanelExplanation(
          await panels.districtPlace(organization),
        ),
      }
    },
  }

  const offer: LlmStreamTool<typeof offerInput> = {
    description:
      'Offer to show the official the invite GoodParty would text in their ' +
      'name. The app shows the question and its answers (Show me the ' +
      'invite, How does it work? and Not now, or without How does it work? ' +
      'after it was answered), so never write them as chat text. Only ' +
      'before they set up their civic panel.',
    inputSchema: offerInput,
    execute: () => (setUp ? notAgain : { offered: true }),
  }

  const presentInvite: LlmStreamTool<typeof noInput> = {
    description:
      'Show the invite as a card. The official opens it to review the ' +
      'words, change them and approve it, which sets up their civic ' +
      'panel. The card shows the invite, so never quote it. Only before ' +
      'they set up their civic panel.',
    inputSchema: noInput,
    execute: () => (setUp ? notAgain : { shown: true }),
  }

  const read: LlmStreamTool<typeof noInput> = {
    description:
      'Read where their civic panel stands: not_set_up, or its status ' +
      '(building: invites going out; paused: no invites go out until they ' +
      'resume it; ready: it reached its goal; exhausted: everyone a text ' +
      'can reach has been invited and it is short of its goal; stopped), ' +
      'its members and member goal, the day the first invites go out, the ' +
      'week it should be ready, when the next invites go out, and the day ' +
      'it was ready.',
    inputSchema: noInput,
    execute: async () => {
      const { panel } = await panels.read(organization)
      if (!panel) return { status: 'not_set_up' }
      const { nextWaveAt } = panel.progress
      return {
        status: panel.status,
        members: panel.progress.members,
        goalMembers: panel.progress.goalMembers,
        ...managedPanelTimeline(panel.approvedAt),
        nextSendDate: nextWaveAt ? format(nextWaveAt, 'EEEE, MMMM d') : null,
        readyDate: panel.readyAt ? format(panel.readyAt, 'MMMM d') : null,
      }
    },
  }

  const present: LlmStreamTool<typeof noInput> = {
    description:
      'Show their civic panel as a card that opens its page, with its ' +
      'status and members of its goal. The card reads the panel itself, ' +
      'so never restate it. Only once they set up their civic panel.',
    inputSchema: noInput,
    execute: async () => {
      const { panel } = await panels.read(organization)
      if (!panel) {
        return {
          error:
            'They have not set up their civic panel. Offer the invite with ' +
            `${OFFER_MANAGED_PANEL_INVITE_TOOL} instead.`,
        }
      }
      return { shown: true }
    },
  }

  return {
    [EXPLAIN_MANAGED_PANEL_TOOL]: explain,
    [OFFER_MANAGED_PANEL_INVITE_TOOL]: offer,
    [PRESENT_MANAGED_PANEL_INVITE_TOOL]: presentInvite,
    [READ_MANAGED_PANEL_TOOL]: read,
    [PRESENT_MANAGED_PANEL_TOOL]: present,
  }
}
