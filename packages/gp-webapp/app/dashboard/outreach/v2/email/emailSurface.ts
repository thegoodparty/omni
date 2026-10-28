import { SMS_PURPOSES } from '../sms/smsCompose.util'

// Everything on the flow that names the people or the user. A surface is one
// product's copy: Serve adds its own object and passes it to the flow, so no
// Win string is renamed to fit it (docs/product-vocabulary.md).
export interface EmailSurface {
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
