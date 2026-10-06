import { BriefingSchema } from '@/chats/briefing-chats/types/briefing.schema'
import type { BriefingChatAnchor } from '@/chats/briefing-chats/services/briefingChatCreate.service'

// THE BRIEFING A briefing_annotation CASE IS ASKED ABOUT, and every value
// around it that reaches the system prompt.
//
// The meeting is the Hendersonville council meeting the briefing chat's own
// prompt evals use (briefing-chats/evals/fixtures/hendersonvilleBriefing
// .fixture.ts), carried over item for item. That fixture is markdown because
// it is handed straight to the prompt builder; this one is the BriefingSchema
// JSON the meeting_briefing pipeline actually writes to S3, because the chat
// parses it on load — get_artifacts reads the parsed form, and a highlight is
// a JSON Pointer into it, so markdown would leave both dead.
//
// FIXED, like everything else the seeder writes. Both arms must render the
// same system prompt when the branch changed nothing the agent can see, or
// every configDigest differs and the identical-config refusal is disarmed.

// A bucket nothing in any deployment writes to. The artifact seam in
// chatSeam.ts answers reads of it, and only of it.
export const JUDGE_BRIEFING_BUCKET = 'judge-fixture-briefings'

export const judgeBriefingKey = (organizationSlug: string): string =>
  `judge-fixture/${organizationSlug}/briefing.json`

export const JUDGE_MEETING_DATE = '2026-05-19'
export const JUDGE_MEETING_TIME = '6:30 PM'
export const JUDGE_MEETING_TIMEZONE = 'America/New_York'

// THE PINNED `today`. Production renders todayInTimezone(meetingTimezone), so
// two arms captured either side of midnight in New York would render two
// prompts for one branch. Five days before the meeting, which is the moment
// the prompt evals' fixture describes, and in the yyyy-MM-dd form
// todayInTimezone returns.
export const JUDGE_BRIEFING_TODAY = '2026-05-14'

const STR_RECOMMENDATION =
  'Approve with the sunset clause. Gets the political win and bakes in an ' +
  'off-ramp if enforcement falters.'

const WATER_WHY_IT_MATTERS =
  'Without the study, the council will be setting rates blind during the ' +
  'FY2027 budget. Deferring also delays a $24M revenue bond rating review.'

const artifact = BriefingSchema.parse({
  version: '1.0',
  generatedAt: '2026-05-12T12:00:00Z',
  generationModel: 'claude-sonnet-4-6',
  meeting: {
    citySlug: 'hendersonville-nc',
    cityName: 'Hendersonville',
    state: 'NC',
    body: 'City Council',
    date: JUDGE_MEETING_DATE,
    time: JUDGE_MEETING_TIME,
    title: 'Regular Council Meeting',
    readTime: '8 min',
    sourceUrl: 'https://example.com/hendersonville-agenda-2026-05-19.pdf',
    sourceType: 'agenda packet',
  },
  executiveSummary: {
    headline:
      'Two contentious items: a short-term-rental cap and a water-rate study.',
    subheadline:
      'The STR ordinance has heavy public-comment momentum; the rate study ' +
      "is technical but politically loaded ahead of next year's budget.",
    priorityItemCount: 2,
    totalAgendaItems: 7,
  },
  priorityIssues: [
    {
      number: 1,
      slug: 'str-ordinance-amendment',
      agendaItemTitle: 'Amendment to Short-Term Rental Ordinance',
      category: 'land use',
      card: {
        headline: 'Cap short-term-rental ownership at one per person',
        whatYouNeedToDo:
          'Decide whether to cap short-term-rental ownership at one ' +
          'property per individual. Vocal opposition from real-estate ' +
          'interests; vocal support from neighborhood associations.',
        askThisInTheRoom:
          'How will the cap be enforced? Who audits LLC ownership chains?',
        tryThis:
          'Propose a 6-month sunset clause so we can review enforcement ' +
          'data before making it permanent.',
        actionButtons: [],
      },
      detail: {
        whatIsHappening:
          'Staff is recommending an amendment to existing Chapter 12 ' +
          'limiting STR registrations to one per natural person, with a ' +
          '90-day transition window. Current ordinance has no cap; ~340 ' +
          'active STRs are concentrated in <50 owners.',
        whatDecision:
          'Approve, deny, or send back to committee with modifications.',
        whyItMatters:
          'Three neighborhood associations have organized against investor ' +
          'concentration. Real-estate-industry groups argue it will harm ' +
          'property values and tax base. ~$1.8M annual occupancy tax revenue ' +
          'is at stake.',
        recommendation: STR_RECOMMENDATION,
        actionItem: 'Move to approve as amended with a 6-month sunset.',
        askThis: 'What is the projected impact on occupancy-tax revenue?',
        tryThis: null,
        whoIsPresenting: 'Planning Director (Jamie Cole)',
        supportingContext:
          'Asheville passed a similar cap in 2024; enforcement litigation ' +
          'is ongoing.',
        supportingDocuments: [
          {
            name: 'Staff Memo on STR Amendment',
            url: 'https://example.com/str-memo.pdf',
          },
        ],
      },
    },
    {
      number: 2,
      slug: 'water-rate-study',
      agendaItemTitle: 'Authorize Cost-of-Service Water Rate Study',
      category: 'infrastructure',
      card: {
        headline: 'Fund a $180K cost-of-service water rate study',
        whatYouNeedToDo:
          'Decide whether to fund a third-party cost-of-service rate study ' +
          'that will likely conclude rates need to rise 8-15% over the next ' +
          '4 years.',
        askThisInTheRoom:
          'What is our debt-service coverage right now and what does it ' +
          'need to be by 2028?',
        tryThis: null,
        actionButtons: [],
      },
      detail: {
        whatIsHappening:
          'Public Works requests $180K from FY2026 reserves to engage ' +
          'Raftelis Financial Consultants for a cost-of-service study. Aging ' +
          'infrastructure (avg 47 years old) and three large capital ' +
          'projects in the 5-year CIP drive the need.',
        whatDecision:
          'Approve the $180K contract or defer to next budget cycle.',
        whyItMatters: WATER_WHY_IT_MATTERS,
        recommendation:
          'Approve. The study itself is not a rate hike; it is the basis ' +
          'for an informed conversation.',
        actionItem: 'Move to approve the Raftelis contract.',
        askThis:
          'What is the realistic timeline if we defer six months? Does it ' +
          'push the bond review?',
        tryThis: null,
        whoIsPresenting: 'Finance Director (Pat Howell)',
        supportingContext: null,
        supportingDocuments: [],
      },
    },
  ],
  fullAgenda: [
    {
      number: '1',
      title: 'Call to Order & Roll Call',
      description: null,
      category: 'procedural',
    },
    {
      number: '2',
      title: 'Public Comment Period',
      description:
        'Open period. Likely heavy STR-ordinance turnout based on ' +
        'social-media signal.',
      category: 'procedural',
    },
    {
      number: '3',
      title: 'Amendment to Short-Term Rental Ordinance',
      description: 'Vote on the one-per-owner cap.',
      category: 'land use',
      isPriority: true,
      priorityNumber: 1,
    },
    {
      number: '4',
      title: 'Authorize Cost-of-Service Water Rate Study',
      description: '$180K contract authorization.',
      category: 'infrastructure',
      isPriority: true,
      priorityNumber: 2,
    },
    {
      number: '5',
      title: 'Acceptance of FY2024 Annual Audit',
      description:
        'Routine acceptance of the audited financial statements. Auditor ' +
        'present to answer questions.',
      category: 'finance',
    },
    {
      number: '6',
      title: 'Resolution Recognizing Local Volunteer of the Year',
      description: null,
      category: 'ceremonial',
    },
    {
      number: '7',
      title: 'Adjournment',
      description: null,
      category: 'procedural',
    },
  ],
  fullAgendaSummary:
    'Seven items. Two priority votes (STR cap, water rate study). One ' +
    'ceremonial item. Standard procedural bookends.',
  constituentData: {
    available: false,
    voterCount: null,
    topIssues: [],
    ideology: null,
  },
  footer: {
    preparedBy: 'GoodParty.org',
    contactNote: 'Questions about this briefing? Reply in the chat.',
  },
})

// What the artifact seam serves. Serialized once so both arms read the same
// bytes, which is what the prompt embeds.
export const JUDGE_BRIEFING_ARTIFACT = JSON.stringify(artifact)

// A passage anchor, located by searching rather than hand-counted, so an
// edit to the text above moves the offsets with it instead of silently
// highlighting the wrong words.
const anchorOn = (
  jsonPath: string,
  node: string,
  phrase: string,
): BriefingChatAnchor => {
  const start = node.indexOf(phrase)
  if (start < 0) {
    throw new Error(`"${phrase}" is not in the text at ${jsonPath}`)
  }
  return { jsonPath, start, end: start + phrase.length }
}

export const TOP_LEVEL_ANCHOR: BriefingChatAnchor = {
  jsonPath: null,
  start: null,
  end: null,
}

// The passage a `briefingHighlight` case opens its chat on: the
// recommendation on the short-term-rental vote.
export const JUDGE_HIGHLIGHT_ANCHOR = anchorOn(
  '/priorityIssues/0/detail/recommendation',
  STR_RECOMMENDATION,
  'Approve with the sunset clause.',
)

// The one note the seeded official has written on this briefing. A note on
// the briefing is what registers get_my_notes, so without it a recall
// question would measure an agent that was never given the tool.
export const JUDGE_NOTE = {
  anchor: anchorOn(
    '/priorityIssues/1/detail/whyItMatters',
    WATER_WHY_IT_MATTERS,
    '$24M revenue bond rating review',
  ),
  body:
    'Ask Pat whether deferring pushes the bond rating review past the ' +
    'FY2027 budget vote. Leaning toward approving the study.',
}
