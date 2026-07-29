import type { ReactNode } from 'react'
import type {
  ActivityConditionAction,
  OutreachType,
  SupportStatusRollup,
} from '@goodparty_org/contracts'
import { DoorOpenIcon, MessageSquareMoreIcon, PhoneIcon } from '@styleguide'

// Channels the list-wizard activity branch exposes (ENG-10708 locked design,
// 2026-07-16 revision). Mirrors the ContactInteraction* channel models —
// p2p shares text's model but isn't offered as its own channel here.
export type ActivityConditionChannel = Extract<
  OutreachType,
  'text' | 'doorKnocking' | 'robocall'
>

// The exact shape gp-api's activityConditionSchema validates
// (src/shared/schemas/activityCondition.schema.ts) — outreachId null means
// "any campaign of this channel".
export interface ActivityConditionInput {
  outreachType: ActivityConditionChannel
  outreachId: number | null
  actions: ActivityConditionAction[]
}

export const ACTIVITY_CONDITION_CHANNELS: {
  value: ActivityConditionChannel
  label: string
  anyLabel: string
  icon: ReactNode
}[] = [
  {
    value: 'text',
    label: 'Text',
    anyLabel: 'Any text campaign',
    icon: <MessageSquareMoreIcon size={16} />,
  },
  {
    value: 'doorKnocking',
    label: 'Door Knocking',
    anyLabel: 'Any door knocking campaign',
    icon: <DoorOpenIcon size={16} />,
  },
  {
    value: 'robocall',
    label: 'Robocall',
    anyLabel: 'Any robocall campaign',
    icon: <PhoneIcon size={16} />,
  },
]

// Per-channel outcome vocabulary. Mirrors gp-api's
// ACTIVITY_CONDITION_CHANNEL_ACTIONS (src/shared/schemas/activityCondition.schema.ts)
// by hand — that map isn't exported through @goodparty_org/contracts, and its
// own comment names this file as the frontend side that has to stay in
// lockstep with it.
export const ACTIVITY_CONDITION_CHANNEL_ACTIONS: Record<
  ActivityConditionChannel,
  readonly ActivityConditionAction[]
> = {
  text: ['responded', 'no_response', 'opted_out'],
  doorKnocking: [
    'answered',
    'not_home',
    'refused_to_engage',
    'support_yes',
    'support_unsure',
    'support_no',
  ],
  robocall: ['answered', 'voicemail_left', 'no_answer'],
}

export const ACTIVITY_CONDITION_ACTION_LABELS: Record<
  ActivityConditionAction,
  string
> = {
  responded: 'Responded',
  no_response: 'No Response',
  opted_out: 'Opted Out',
  answered: 'Answered',
  not_home: 'Not Home',
  refused_to_engage: 'Refused to Engage',
  support_yes: 'Support: Yes',
  support_unsure: 'Support: Unsure',
  support_no: 'Support: No',
  voicemail_left: 'Voicemail Left',
  no_answer: 'No Answer',
}

// Door-knock interactions have no outreach linkage — gp-api rejects an
// outreachId on a doorKnocking condition (voterFileFilter.service.ts's
// validateActivityConditions), so the specific-campaign select never renders
// for this channel.
export const CHANNELS_WITHOUT_CAMPAIGN_PICKER =
  new Set<ActivityConditionChannel>(['doorKnocking'])

// All five SupportStatusRollup values (ENG-10837 — product decision
// 2026-07-28 to match the profile vocabulary). undecided/refused only ever
// come from a manual override (gp-api's SupportStatusService.
// personIdsByEffectiveStatus resolves overrides alongside derivation), so
// filtering on them matches nobody until a person has been manually set.
// This is the single source for both the wizard's pills (VoterFileStep) and
// the saved-list summary labels (ListFilterSummary) — don't duplicate.
export const SUPPORT_STATUS_OPTIONS: {
  value: SupportStatusRollup
  label: string
}[] = [
  { value: 'supporter', label: 'Supporter' },
  { value: 'non_supporter', label: 'Non-supporter' },
  { value: 'undecided', label: 'Undecided' },
  { value: 'refused', label: 'Refused' },
  { value: 'unknown', label: 'Support Unknown' },
]
