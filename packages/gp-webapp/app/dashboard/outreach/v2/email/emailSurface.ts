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
  compose: { title: string; caption: string }
  audience: {
    title: string
    caption: string
    consentLabel: string
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
  },
  audience: {
    title: 'Who do you want to reach?',
    caption: 'Upload a list with an email column. Names are optional.',
    consentLabel: 'These people agreed to get email from my campaign.',
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
  },
  audience: {
    title: 'Who do you want to reach?',
    caption: 'Upload a list with an email column. Names are optional.',
    consentLabel: 'These people agreed to get email from my office.',
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
