import { PriorityAnswerCode } from '../../generated/prisma'

// The one priority every Test mode civic panel is asked about, and what
// its members say back. Shared by every test org, so nothing here names a
// place or a person.
export const CIVIC_PANEL_FIXTURE_PRIORITY = {
  title: 'Safer walks to school',
  description:
    'Parents have asked for safer crossings and slower traffic on the ' +
    'streets children walk to school.',
}

export const CIVIC_PANEL_FIXTURE_SEND = {
  name: 'Test mode civic panel question',
  message:
    'Should we add crosswalks and slower speed limits near schools, even ' +
    'if some drives take a little longer? Reply with your thoughts.\n\n' +
    'Reply STOP to opt out.',
}

export const CIVIC_PANEL_FIXTURE_INVITE =
  'Hi, this is your local elected official. I want to hear from ' +
  'residents before I vote on the issues that matter here.\n\n' +
  'Reply JOIN to share your perspectives.\nReply STOP to opt out.'

type FixtureTheme = {
  title: string
  summary: string
  code: PriorityAnswerCode
  replies: string[]
}

export const CIVIC_PANEL_FIXTURE_THEMES: FixtureTheme[] = [
  {
    title: 'Marked crosswalks at school corners',
    summary:
      'Residents want painted crosswalks and crossing guards at the ' +
      'corners closest to schools.',
    code: PriorityAnswerCode.yes,
    replies: [
      'Yes. The corner by the elementary school has no crosswalk at all.',
      'Please add crosswalks. My kids cross four lanes to get to class.',
      'Yes, and a crossing guard in the mornings would help a lot.',
      'Absolutely. Drivers do not stop because nothing is painted there.',
      'Yes to crosswalks. I walk my daughter every day and it is scary.',
      'Painted crossings and a flashing sign. Long overdue.',
    ],
  },
  {
    title: 'Slower speeds in school zones',
    summary:
      'Many support lower speed limits during school hours, with ' +
      'enforcement so the limits mean something.',
    code: PriorityAnswerCode.yes,
    replies: [
      'Yes. People fly down that road at pickup time.',
      'A 20 mph limit during school hours makes sense to me.',
      'Slower limits only work if someone enforces them. Add cameras.',
      'Yes, a few extra seconds of driving is worth a safe kid.',
      'Speed bumps would do more than signs, but yes.',
      'Yes. I have seen too many close calls near the middle school.',
    ],
  },
  {
    title: 'Worried about traffic delays',
    summary:
      'Some residents worry slower limits will back up traffic on roads ' +
      'they already find congested.',
    code: PriorityAnswerCode.no,
    replies: [
      'No. Traffic is already bad and this will make my commute worse.',
      'I do not think we need lower limits. Fix the lights instead.',
      'No, the main road backs up enough as it is.',
      'Not on the main roads. Maybe on side streets only.',
      'I am against it. Most drivers already slow down near schools.',
      'No. Spend the money on buses instead.',
    ],
  },
  {
    title: 'Gaps in sidewalks',
    summary:
      'Residents point out missing sidewalk stretches that force ' +
      'children to walk in the street.',
    code: PriorityAnswerCode.mixed,
    replies: [
      'Crosswalks are fine but there is no sidewalk on half my street.',
      'Maybe. Sidewalks matter more than speed limits where I live.',
      'Kids walk in the road because the sidewalk just ends. Fix that first.',
      'Not sure about speed limits, but we badly need sidewalks.',
      'Some of both. Finish the sidewalk near the park, then crosswalks.',
      'I would rather see sidewalks repaired. They are cracked and unsafe.',
    ],
  },
]
