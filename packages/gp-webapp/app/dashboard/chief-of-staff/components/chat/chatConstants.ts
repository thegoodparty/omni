import { BUILD_CITIZENS_PANEL_MESSAGE } from '@goodparty_org/contracts'
import { humanizeToolName } from '../../../shared/agent-chat/toolLabels'
import type { ChatSuggestion } from './ChiefOfStaffChatBody'
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
 * What the Chief of Staff says when an official meets it on the Serve home:
 * the meet card's opener, and the first chat ever from the footer bar. It ends
 * on a question that `buildChiefOfStaffNextSteps` answers with cards, the way
 * the Campaign Manager's greeting ends on its starter cards.
 */
export const buildChiefOfStaffIntro = (firstName?: string | null): string[] => [
  firstName
    ? `Hi ${firstName}, I'm your Chief of Staff.`
    : "Hi, I'm your Chief of Staff.",
  'I get you ready for each meeting with a briefing, and I keep track of ' +
    'what residents are raising.',
  'I can help you move your priorities forward, draft an ordinance, and ' +
    'reach your constituents.',
  'What would you like to start with?',
]

export const NEXT_STEP_MESSAGES = {
  meeting: 'Help me get ready for my next meeting.',
  issues: 'What are residents raising right now?',
  priority: 'Help me move one of my priorities forward.',
  askPanel: 'Help me ask my civic panel about a priority.',
  outreach: 'Help me reach constituents about something in my district.',
} as const

/**
 * The cards under the Chief of Staff's intro, one per thing it can start from
 * this chat. The civic panel card is there only with serve-citizen-panels on:
 * an office with members asks its panel, any other builds one (the build turn
 * itself says so when an invite is already out). `panelMembers` is undefined
 * until the panel summary loads.
 */
export const buildChiefOfStaffNextSteps = ({
  panelsEnabled,
  panelMembers,
  onDraftOrdinance,
}: {
  panelsEnabled: boolean
  panelMembers?: number
  onDraftOrdinance: () => void
}): ChatSuggestion[] => [
  {
    label: 'Get ready for your next meeting',
    description: 'Walk in knowing what is on the agenda and what to ask.',
    message: NEXT_STEP_MESSAGES.meeting,
  },
  {
    label: 'See what residents are raising',
    description: 'Hear the issues people in your district care about most.',
    message: NEXT_STEP_MESSAGES.issues,
  },
  {
    label: 'Move a priority forward',
    description: 'Pick what matters most to you and get the next step done.',
    message: NEXT_STEP_MESSAGES.priority,
  },
  ...(panelsEnabled
    ? [
        panelMembers !== undefined && panelMembers > 0
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
      ]
    : []),
  {
    label: 'Draft an ordinance',
    description:
      'Turn a problem in your district into language you can bring to a vote.',
    onSelect: onDraftOrdinance,
  },
  {
    label: 'Reach your constituents',
    description: 'Get the right message to the residents who need it.',
    message: NEXT_STEP_MESSAGES.outreach,
  },
]

/**
 * The step under the answer to What's a civic panel?, matching how the reply
 * ends. The question comes from the build card, which is only up while no
 * invite has gone out, so the panel's members decide it: none builds one in
 * the same conversation, some asks it. No card until the summary loads.
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
