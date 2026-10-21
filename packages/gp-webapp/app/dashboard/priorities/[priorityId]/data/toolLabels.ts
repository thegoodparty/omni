// Priority-flow tool -> the label on its inline pill while it runs. The tools
// that move the rail or leave a card are absent on purpose: those are consumed
// before the pill path, so a label here would render them twice.
export const PRIORITY_TOOL_LABELS: Record<string, string | undefined> = {
  web_search: 'Searching the web',
  read_community_issues: 'Reading your community issues',
  read_past_outreach: "Checking what you've sent",
  describe_filter_dimensions: 'Checking available filters',
  count_contacts: 'Counting constituents',
  list_precincts: 'Looking up precincts',
  crud_saved_filters: 'Working on your lists',
  size_round_one: 'Sizing your first round of outreach',
  size_outreach_sample: 'Sizing a sample',
  read_outreach_feedback: 'Reading what came back',
  read_report_back: 'Checking who still needs a report back',
  query_constituent_data: 'Reviewing district data',
  describe_constituent_data: 'Reviewing district data',
}

export const priorityToolLabel = (name: string): string | null =>
  PRIORITY_TOOL_LABELS[name] ?? null
