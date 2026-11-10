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
  look: { title: string; caption: string }
  audience: {
    picker: OutreachAudienceCopy
    noEmails: string
    noEmailsEveryone: string
  }
  // The line under every step while contacts imported in or out of the flow
  // are still being added, and how the one imported here ended.
  importStatus: {
    adding: (added: number) => string
    needReview: (count: number) => string
    payOnceAdded: string
    added: (count: number) => string
    failed: string
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
  look: {
    title: 'How should it look?',
    caption: 'Pick a layout and colors for your email.',
  },
  audience: {
    picker: {
      pickerTitle: 'Who do you want to reach?',
      pickerBody:
        'Only people you imported with an email address can get email.',
      pickerBodyAction: 'Upload contacts',
      filtersTitle: 'Build a voter list',
      filtersBody: 'Pick filters to define who this campaign reaches.',
      nameTitle: 'Name your list',
      nameBody: 'You can rename it any time.',
      reachVerb: 'Email',
      reachNoun: 'voters with an email address',
      reachLine: (count: number) =>
        `${count.toLocaleString()} ${count === 1 ? 'person' : 'people'} with an email address`,
      unitCostLabel: 'Each email costs',
      universeLabel: 'Everyone with an email',
    },
    noEmails:
      'No one in this list has an email address yet. Pick another list to keep going.',
    noEmailsEveryone:
      'None of your contacts has an email address yet. Import some to send an email.',
  },
  importStatus: {
    adding: (added: number) =>
      added > 0
        ? `Adding your contacts… ${added.toLocaleString()} so far.`
        : 'Adding your contacts…',
    needReview: (count: number) =>
      `${count.toLocaleString()} ${count === 1 ? 'needs' : 'need'} your review.`,
    payOnceAdded: "You can pay once they're added.",
    added: (count: number) =>
      `${count.toLocaleString()} ${count === 1 ? 'contact' : 'contacts'} added.`,
    failed:
      "Your contacts didn't finish importing. Try again from your import history.",
  },
  schedule: {
    title: 'When should it go out?',
    caption: 'Pick a day in the next 30 days.',
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
  look: {
    title: 'How should it look?',
    caption: 'Pick a layout and colors for your email.',
  },
  audience: {
    picker: {
      ...WIN_EMAIL_SURFACE.audience.picker,
      filtersTitle: 'Build a constituent list',
      filtersBody: 'Pick filters to define who this list reaches.',
      reachNoun: 'constituents with an email address',
    },
    noEmails: WIN_EMAIL_SURFACE.audience.noEmails,
    noEmailsEveryone: WIN_EMAIL_SURFACE.audience.noEmailsEveryone,
  },
  importStatus: WIN_EMAIL_SURFACE.importStatus,
  schedule: {
    title: 'When should it go out?',
    caption: 'Pick a day in the next 30 days.',
  },
  review: {
    title: 'Ready to send?',
    caption: 'Check how it reads and who it reaches.',
  },
  recipientsNoun: 'constituents',
}
