import {
  CONSTITUENT_NAME_TOKEN,
  DOOR_KNOCKING_BULLET,
  type CivicPanelReachChannel,
} from '@goodparty_org/contracts'
import { useUser } from '@shared/hooks/useUser'
import { usePositionName } from '@shared/hooks/usePositionName'
import { grammarizeOfficeName } from 'app/polls/onboarding/utils/grammarizeOfficeName'
import { useServePlace } from './managedPanelCopy'

// What a volunteer marks on the knock or call form, so a yes counts as a
// join from the door or the phone.
const MARK_A_YES = 'If they say yes, mark them as joining the civic panel.'

// The civic panel invite read at a door or on a call to a short group, in
// the SMS invite's voice (managedInviteDraft): who it is from, hearing from
// people across the place, about once a month. Spoken by whoever knocks or
// calls, so it says "we", and it never says how the office will check in:
// these homes have no cell phone on file.
export const civicPanelReachScript = ({
  channel,
  name,
  office,
  place,
}: {
  channel: CivicPanelReachChannel
  name: string
  office: string
  place: string | null
}): string => {
  const official = office.trim() || 'local elected official'
  const forWhom = name.trim()
    ? `${name.trim()}, your ${official}`
    : `your ${official}`
  const why =
    `We want to hear from people across ${place ?? 'our community'}, not ` +
    "just those who come to meetings, so we're inviting a group of " +
    'residents to share their views.'
  if (channel === 'door') {
    return [
      `${DOOR_KNOCKING_BULLET}Hi, I'm here for ${forWhom}.`,
      `${DOOR_KNOCKING_BULLET}${why}`,
      `${DOOR_KNOCKING_BULLET}About once a month, we'll check in to ask what you think. You can stop any time.`,
      `${DOOR_KNOCKING_BULLET}Would you like to be one of them?`,
      MARK_A_YES,
    ].join('\n')
  }
  return [
    `You: Hi, is this ${CONSTITUENT_NAME_TOKEN}? I'm calling for ${forWhom}. Do you have a minute?`,
    'Constituent: Sure.',
    `You: ${why} About once a month, we'll check in to ask what you think, and you can stop any time. Would you like to be one of them?`,
    'Constituent: Yes, count me in.',
    "You: Thank you. We'll be in touch soon.",
    MARK_A_YES,
  ].join('\n')
}

export const useCivicPanelReachScript = (
  channel: CivicPanelReachChannel,
): string => {
  const [user] = useUser()
  const office = grammarizeOfficeName(usePositionName())
  const place = useServePlace()
  const name = `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim()
  return civicPanelReachScript({ channel, name, office, place })
}
