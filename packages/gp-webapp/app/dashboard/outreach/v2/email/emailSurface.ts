import type { OutreachAudienceCopy } from '../audience/OutreachAudienceStep'
import { SMS_PURPOSES } from '../sms/smsCompose.util'
import { SERVE_SMS_PURPOSES } from '../serveSmsPurposes'

// Everything on the flow that names the people or the user. A surface is one
// product's copy: Serve adds its own object and passes it to the flow, so no
// Win string is renamed to fit it (docs/product-vocabulary.md).
export interface EmailSurface {
  isServe: boolean
  goals: { id: string; label: string }[]
  customGoalId: string
  goal: { title: string; caption: string; customLabel: string }
  compose: { title: string; caption: string; buttonLinkHint: string }
  audience: {
    picker: OutreachAudienceCopy
    consentLabel: string
    noEmails: string
  }
  schedule: { title: string; caption: string }
  review: { title: string; caption: string }
  recipientsNoun: string
}

export const WIN_EMAIL_SURFACE: EmailSurface = {
  isServe: false,
  goals: SMS_PURPOSES,
  customGoalId: 'custom',
  goal: {
    title: 'What do you want to do?',
    caption: 'This helps us set up the right email for your campaign.',
    customLabel: 'What is this email for?',
  },
  compose: {
    title: 'What do you want to say?',
    caption: 'Write it your way. Voters see it just like the preview.',
    buttonLinkHint: 'Add the link voters go to when they tap it.',
  },
  audience: {
    picker: {
      pickerTitle: 'Who do you want to reach?',
      pickerBody:
        'Select a list or create a new one. Only voters with an email address are included.',
      filtersTitle: 'Build a voter list',
      filtersBody: 'Pick filters to define who this campaign reaches.',
      nameTitle: 'Name your list',
      nameBody: 'You can rename it any time.',
      reachVerb: 'Email',
      reachNoun: 'voters with an email address',
      unitCostLabel: 'Each email costs',
    },
    consentLabel: 'These people agreed to get email from my campaign.',
    noEmails:
      'No one in this list has an email address yet. Pick another list to keep going.',
  },
  schedule: {
    title: 'When should it go out?',
    caption:
      'Send it as soon as it is paid, or pick a day in the next 30 days.',
  },
  review: {
    title: 'Ready to send?',
    caption: 'Check how it reads and who it reaches.',
  },
  recipientsNoun: 'people',
}

const SERVE_EMAIL_GOAL_IDS: string[] = [
  'introduce_myself',
  'explain_decision',
  'event_invite',
  'community_input',
  'share_resource',
  'custom',
]

export const SERVE_EMAIL_SURFACE: EmailSurface = {
  isServe: true,
  goals: SERVE_SMS_PURPOSES.filter((p) => SERVE_EMAIL_GOAL_IDS.includes(p.id)),
  customGoalId: 'custom',
  goal: {
    title: 'What do you want to do?',
    caption: 'This helps us set up the right email for your constituents.',
    customLabel: 'What is this email for?',
  },
  compose: {
    title: 'What do you want to say?',
    caption: 'Write it your way. Constituents see it just like the preview.',
    buttonLinkHint: 'Add the link constituents go to when they tap it.',
  },
  audience: {
    picker: {
      ...WIN_EMAIL_SURFACE.audience.picker,
      pickerBody:
        'Select a list or create a new one. Only constituents with an email address are included.',
      filtersTitle: 'Build a constituent list',
      filtersBody: 'Pick filters to define who this list reaches.',
      reachNoun: 'constituents with an email address',
    },
    consentLabel: 'These people agreed to get email from my office.',
    noEmails: WIN_EMAIL_SURFACE.audience.noEmails,
  },
  schedule: {
    title: 'When should it go out?',
    caption:
      'Send it as soon as it is paid, or pick a day in the next 30 days.',
  },
  review: {
    title: 'Ready to send?',
    caption: 'Check how it reads and who it reaches.',
  },
  recipientsNoun: 'constituents',
}
