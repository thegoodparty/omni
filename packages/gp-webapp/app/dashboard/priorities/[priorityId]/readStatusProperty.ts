import {
  OutreachProposalSchema,
  type CivicPanelBalanceStatus,
  type OutreachProposal,
  type PriorityReadStatus,
  type ReadRepresentativeness,
} from '@goodparty_org/contracts'

// A priority's read status, as the `readStatus` analytics property spells it.
export const READ_STATUS_PROPERTY: Record<ReadRepresentativeness, string> = {
  tooEarly: 'waiting_on_groups',
  notYetRepresentative: 'groups_need_answers',
  gettingClose: 'groups_unsure',
  representative: 'every_group_heard',
  enoughAnswers: 'enough_answers',
}

// The civic panel's status, as its analytics property spells it.
export const PANEL_STATUS_PROPERTY: Record<CivicPanelBalanceStatus, string> = {
  tooFewMembers: 'too_few_members',
  missingGroups: 'missing_groups',
  everyGroup: 'every_group',
}

// A priority's read on Get answers: waiting or good, and how many major
// groups are still short of their answers.
export const readProperties = (
  read: PriorityReadStatus | null,
): { readStatus?: 'good' | 'waiting'; groupsShort?: number } =>
  read
    ? {
        readStatus: read.good ? 'good' : 'waiting',
        groupsShort: Math.max(0, read.groupsTotal - read.groupsHeard),
      }
    : {}

const PROPOSED_CHANNEL: Partial<
  Record<OutreachProposal['channel'], 'text' | 'door' | 'call'>
> = {
  text: 'text',
  doorKnocking: 'door',
  phoneBanking: 'call',
}

// Priorities - Outreach Proposed for a proposal card the agent drew, or null
// for one that is not an ask (a report back, a social post).
export const outreachProposedProperties = (
  args: unknown,
): {
  round: 'one' | 'follow_up'
  sampleSize: number
  targetGroup: string
  channel: 'text' | 'door' | 'call'
} | null => {
  const parsed = OutreachProposalSchema.omit({ proposalKey: true }).safeParse(
    args,
  )
  if (!parsed.success) return null
  const proposal = parsed.data
  const channel = PROPOSED_CHANNEL[proposal.channel]
  if (!channel || proposal.reportBackForOutreachId !== undefined) return null
  return {
    round: (proposal.widensOutreachIds?.length ?? 0) > 0 ? 'follow_up' : 'one',
    sampleSize: proposal.sampleSize ?? proposal.count,
    targetGroup:
      proposal.areaTarget === 'unreached'
        ? 'unreached_areas'
        : (proposal.side ?? 'everyone'),
    channel,
  }
}
