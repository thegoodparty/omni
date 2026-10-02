// What a candidate sees on the pill while an agent runs a tool.
//
// The rule is that a machine name must never reach the screen. That is
// enforced by the fallback rather than by a lookup table, because a table is
// only as good as whoever remembers to add to it: tools are registered in
// gp-api (`tools.<name> = ...`), the webapp has no build-time list of them,
// and the old behaviour was to print whatever arrived — which is how
// `campaign_story` ended up on a pill.
//
// So: an override when a tool needs words the name cannot give, otherwise a
// humanized form of the name itself, which for almost every tool is already
// right ("campaign_story" -> "Campaign story").

// Sentence case per the house style, not Title Case.
export const humanizeToolName = (toolName: string): string => {
  const words = toolName.replace(/[_-]+/g, ' ').trim()
  if (words.length === 0) return ''
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase()
}

// Only where humanizing is wrong, not merely plain. Internal acronyms and
// vendor names are the two cases that cannot fix themselves.
const TOOL_LABEL_OVERRIDES: Record<string, string> = {
  crud_priorities: 'Priorities',
  // The candidate does not care which search vendor answered.
  brave_search: 'Web search',
  web_search: 'Web search',
}

export const resolveToolLabel = (
  toolName: string,
  overrides?: Record<string, string>,
): string =>
  overrides?.[toolName] ??
  TOOL_LABEL_OVERRIDES[toolName] ??
  humanizeToolName(toolName)
