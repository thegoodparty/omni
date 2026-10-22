import { addDays, format, parseISO, startOfWeek } from 'date-fns'
import { z } from 'zod'
import type { ManagedCivicPanel } from '@goodparty_org/contracts'
import type { Organization } from '../../../../generated/prisma'
import type { LlmStreamTool } from '@/llm/services/llm.service'
import type { ManagedCivicPanelService } from '@/contacts/services/managedCivicPanel.service'
import { earliestServeSmsSendDate } from '@/outreach/services/outreachServeSmsCreate.service'

export const OFFER_MANAGED_PANEL_INVITE_TOOL = 'offer_managed_panel_invite'
export const PRESENT_MANAGED_PANEL_INVITE_TOOL = 'present_managed_panel_invite'
export const READ_MANAGED_PANEL_TOOL = 'read_managed_panel'
export const PRESENT_MANAGED_PANEL_TOOL = 'present_managed_panel'

// The waves run over about two weeks from the first send.
const BUILD_DAYS = 14

// GoodParty builds the panel for the office (the managed panel): the
// official approves one invite and GoodParty texts it in waves. The offer,
// the invite and the panel are widgets the app draws from fixed words and
// the enrollment it reads itself; these tools only decide whether they may
// be shown, and read where the panel stands.

const noInput = z.object({})

// When the first invites go out and the week the panel should be ready,
// from the day it was approved: the earliest day a Serve text can be sent,
// and about two weeks of waves after it.
export const managedPanelTimeline = (approvedAt: Date) => {
  const firstSend = parseISO(earliestServeSmsSendDate(approvedAt))
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

  const offer: LlmStreamTool<typeof noInput> = {
    description:
      'Offer to show the official the invite GoodParty would text in their ' +
      'name. The app shows the question and its answers (Show me the ' +
      'invite, Who gets texted?, Not now), so never write them as chat ' +
      'text. Only before they set up their civic panel.',
    inputSchema: noInput,
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
      '(building, ready, paused or stopped), its members and member goal, ' +
      'the day the first invites go out, the week it should be ready, and ' +
      'when the next invites go out.',
    inputSchema: noInput,
    execute: async () => {
      const { panel } = await panels.read(organization)
      if (!panel) return { status: 'not_set_up' }
      const { nextWaveAt } = panel.progress
      return {
        status: panel.status,
        members: panel.progress.members,
        goalMembers: panel.progress.goalMembers,
        wavesSent: panel.progress.wavesSent,
        ...managedPanelTimeline(panel.approvedAt),
        nextSendDate: nextWaveAt ? format(nextWaveAt, 'EEEE, MMMM d') : null,
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
    [OFFER_MANAGED_PANEL_INVITE_TOOL]: offer,
    [PRESENT_MANAGED_PANEL_INVITE_TOOL]: presentInvite,
    [READ_MANAGED_PANEL_TOOL]: read,
    [PRESENT_MANAGED_PANEL_TOOL]: present,
  }
}
