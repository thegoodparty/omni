// Priority-flow tool -> the label on its inline pill while it runs. The tools
// that move the rail or leave a card are absent on purpose: those are consumed
// before the pill path, so a label here would render them twice.
export const PRIORITY_TOOL_LABELS: Record<string, string | undefined> = {
  web_search: 'Searching the web',
  read_community_issues: 'Reading your community issues',
  read_past_outreach: "Checking what you've sent",
  describe_filter_dimensions: 'Checking available filters',
  count_contacts: 'Counting constituents',
  crud_saved_filters: 'Working on your lists',
  query_constituent_data: 'Reviewing district data',
  describe_constituent_data: 'Reviewing district data',
}

export const priorityToolLabel = (name: string): string | null =>
  PRIORITY_TOOL_LABELS[name] ?? null
