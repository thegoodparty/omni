import { BUILD_CITIZENS_PANEL_MESSAGE } from '@goodparty_org/contracts'
import { humanizeToolName } from '../../../shared/agent-chat/toolLabels'
/**
 * Hard-coded intro the Chief of Staff plays on first open (before any
 * conversation exists). These are display-only — they are not persisted and
 * are not sent to the model. Once the user sends a first message, the deferred
 * conversation is created and the real transcript takes over.
 */
export const COS_INTRO_MESSAGES: string[] = [
  "Hi, I'm your Chief of Staff.",
  'I keep track of your meetings, briefings, and the priorities you care ' +
    'about, and I can help you prepare, draft, and decide.',
  'Ask me anything, or tell me what matters most to you so I can tailor my ' +
    'help.',
]

/**
 * A starter chip. `kickoff` fires an on-demand hidden send of that string
 * (no user bubble), `message` sends that string as the user's own message;
 * otherwise `onSelect` runs. `description` renders a secondary line beneath
 * the label.
 */
export type ChatSuggestion = {
  label: string
  description?: string
  onSelect?: () => void
  kickoff?: string
  message?: string
}

/**
 * What the Chief of Staff says when an official meets it on the Serve home:
 * the meet card's opener, and the first chat ever from the footer bar. It ends
 * on a question that `buildChiefOfStaffNextSteps` answers with cards, the way
 * the Campaign Manager's greeting ends on its starter cards.
 */
export const buildChiefOfStaffIntro = (firstName?: string | null): string[] => [
  firstName
    ? `Hi ${firstName}, I'm your Chief of Staff.`
    : "Hi, I'm your Chief of Staff.",
  'I track what residents are raising and help you decide what to make a ' +
    'priority.',
  'I can help you hear from your constituents, and I get you ready for each ' +
    'meeting.',
  'What would you like to start with?',
]

export const NEXT_STEP_MESSAGES = {
  priorities: 'What are residents raising, and what should I make a priority?',
  askPanel: 'Help me ask my civic panel about a priority.',
  outreach: 'Help me reach constituents about something in my district.',
  meeting: 'Help me get ready for my next meeting.',
} as const

/**
 * The three cards under the Chief of Staff's intro: priorities, hearing from
 * constituents, and meetings. With serve-citizen-panels on, the middle card is
 * the civic panel: an office with members asks its panel, any other builds one
 * here, on the same plan as the panel page. `panelMembers` is undefined until
 * the panel summary loads. The middle card waits out `panelLoading` so it never
 * shows one card and then swaps to another.
 */
export const buildChiefOfStaffNextSteps = ({
  panelsEnabled,
  panelMembers,
  panelLoading = false,
}: {
  panelsEnabled: boolean
  panelMembers?: number
  panelLoading?: boolean
}): ChatSuggestion[] => [
  {
    label: 'See what matters in your community',
    description:
      'What residents are raising, and which issues to make a priority.',
    message: NEXT_STEP_MESSAGES.priorities,
  },
  ...(panelLoading
    ? []
    : [
        !panelsEnabled
          ? {
              label: 'Hear from your constituents',
              description: 'Ask the residents affected what they think.',
              message: NEXT_STEP_MESSAGES.outreach,
            }
          : panelMembers !== undefined && panelMembers > 0
            ? {
                label: 'Ask your civic panel',
                description: 'Hear what residents think before you decide.',
                message: NEXT_STEP_MESSAGES.askPanel,
              }
            : {
                label: 'Build your civic panel',
                description:
                  'Hear from residents before you decide, not only the ' +
                  'loudest voices.',
                kickoff: BUILD_CITIZENS_PANEL_MESSAGE,
              },
      ]),
  {
    label: 'Get ready for your next meeting',
    description: 'Walk in knowing what is on the agenda and what to ask.',
    message: NEXT_STEP_MESSAGES.meeting,
  },
]

/**
 * The step under the answer to What's a civic panel?, matching how the reply
 * ends. The question comes from the build card, which is only up while no
 * invite has gone out, so the panel's members decide it: none builds one in
 * this chat, some asks it. No card until the summary loads.
 */
export const civicPanelExplainNextStep = (
  panelMembers: number | undefined,
): ChatSuggestion | undefined => {
  if (panelMembers === undefined) return undefined
  return panelMembers > 0
    ? {
        label: 'Ask your panel about a priority',
        message: NEXT_STEP_MESSAGES.askPanel,
      }
    : { label: 'Build my panel', kickoff: BUILD_CITIZENS_PANEL_MESSAGE }
}

/**
 * gp-api's saved-filter write tool (ENG-10736). A `tool_result` for it means
 * the agent may have created, updated, or deleted a saved contact list, so the
 * contacts queries need a refetch — see ChiefOfStaffChatBody's `onEvent`.
 */
export const SAVED_FILTERS_TOOL = 'crud_saved_filters'

/**
 * Tool names map to a human status line shown while the agent runs them. The
 * server emits these tool names in `tool_call` SSE events; unknown names fall
 * back to the raw name.
 */
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  web_search: 'Searching the web',
  crud_priorities: 'Working on your priorities',
  record_check_reminder: 'Noting that on your priority',
  list_briefings: 'Reading your briefings',
  get_briefing: 'Reading your briefings',
  read_community_issues: 'Reading your community issues',
  read_past_outreach: "Checking what you've sent",
  describe_filter_dimensions: 'Checking available filters',
  count_contacts: 'Counting matches',
  list_precincts: 'Looking up precincts',
  [SAVED_FILTERS_TOOL]: 'Working on your lists',
  save_panel_weekly_time: 'Making your panel plan',
  constituent_data: 'Reviewing district data',
  query_constituent_data: 'Reviewing district data',
  describe_constituent_data: 'Reviewing district data',
  search_help_center: 'Searching the help center',
  size_outreach_sample: 'Sizing a sample',
  // Campaign Manager's own tools: this table serves both chats.
  get_ballot_requirements: 'Checking how to get on the ballot', // serve-vocabulary-allow: Campaign Manager tool label
  campaign_story: 'Working on your story',
}

export function toolDisplayName(toolName: string): string {
  // Humanized rather than raw: a tool that is not in the map above still has
  // to read as words on the pill, not as its machine name.
  return TOOL_DISPLAY_NAMES[toolName] ?? humanizeToolName(toolName)
}

/**
 * For tools whose verb depends on what they're doing, a per-action label keyed
 * by the tool's `action` input. Live-only: tool args aren't persisted, so a
 * reloaded conversation falls back to the base name above.
 */
const TOOL_ACTION_LABELS: Record<string, Record<string, string>> = {
  crud_priorities: {
    list: 'Reading your priorities',
    create: 'Saving your priorities',
    update: 'Updating your priorities',
    archive: 'Removing a priority',
  },
}

export function toolStatusLabel(toolName: string, action?: string): string {
  if (action) {
    const label = TOOL_ACTION_LABELS[toolName]?.[action]
    if (label) return label
  }
  return toolDisplayName(toolName)
}
