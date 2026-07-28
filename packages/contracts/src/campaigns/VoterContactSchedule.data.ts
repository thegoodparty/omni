/**
 * The canonical voter-contact schedule: the plan's 7 text/robocall sends, as
 * days before election day. Single source of truth for every surface that
 * shows these dates — the plan document's Voter Contact Plan section
 * (gp-webapp `planContent.ts`), the tracker catalog's outreach timing (below,
 * `CampaignTaskCatalog.data.ts`), and the CAS Slack posts that feed the
 * ClickUp automation (gp-api). Candidates are told to calendar these dates
 * and ops nudges against the ClickUp copies, so the surfaces must never
 * disagree. Cadence confirmed with CAS (intro ~8 weeks out).
 */
export const VOTER_CONTACT_SCHEDULE = [
  {
    catalogId: 'introduction-text',
    tactic: 'Text',
    daysBeforeElection: 56,
    purpose: 'Introduce yourself to voters with cellphones.',
  },
  {
    catalogId: 'introduction-robocall',
    tactic: 'Robocall',
    daysBeforeElection: 49,
    purpose: 'Introduce yourself to voters with landlines.',
  },
  {
    catalogId: 'persuasion-text',
    tactic: 'Text',
    daysBeforeElection: 35,
    purpose: 'Build trust and persuade voters with cellphones to vote for you.',
  },
  {
    catalogId: 'persuasion-robocall',
    tactic: 'Robocall',
    daysBeforeElection: 28,
    purpose: 'Build trust and persuade voters with landlines to vote for you.',
  },
  {
    catalogId: 'early-voting-text',
    tactic: 'Text',
    daysBeforeElection: 14,
    purpose: 'Encourage voters with cellphones to vote early.',
  },
  {
    catalogId: 'election-day-reminder-robocall',
    tactic: 'Robocall',
    daysBeforeElection: 1,
    purpose: 'Get out the vote on election day.',
  },
  {
    catalogId: 'election-day-reminder-text',
    tactic: 'Text',
    daysBeforeElection: 0,
    purpose: 'Get out the vote on election day.',
  },
] as const

export type VoterContactSend = (typeof VOTER_CONTACT_SCHEDULE)[number]

export const voterContactSendOffsetDays = (catalogId: string): number => {
  const send = VOTER_CONTACT_SCHEDULE.find((s) => s.catalogId === catalogId)
  if (!send) {
    throw new Error(`Unknown voter-contact send: ${catalogId}`)
  }
  return send.daysBeforeElection
}
