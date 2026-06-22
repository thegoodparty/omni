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
 * Tool names map to a human status line shown while the agent runs them. The
 * server emits these tool names in `tool_call` SSE events; unknown names fall
 * back to the raw name.
 */
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  web_search: 'Searching the web',
  crud_priorities: 'Working on your priorities',
  list_briefings: 'Reading your briefings',
  get_briefing: 'Reading your briefings',
  constituent_data: 'Reviewing district data',
  query_constituent_data: 'Reviewing district data',
  describe_constituent_data: 'Reviewing district data',
}

export function toolDisplayName(toolName: string): string {
  return TOOL_DISPLAY_NAMES[toolName] ?? toolName
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
