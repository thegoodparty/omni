// Ordinance-flow tool -> the user-facing label shown on its "running" pill.
// Bookkeeping/internal tools are intentionally absent, so they never show a pill
// (the "Thinking..." shimmer covers that wait instead). Shared by the guided
// flow chat and the draft chat, which drive the same ordinance_flow conversation.
// Partial lookup: keyed by arbitrary streamed tool names, only the labelled
// ones are present (the rest fall back to null via ordinanceToolLabel).
export const ORDINANCE_TOOL_LABELS: Record<string, string | undefined> = {
  web_search: 'Searching the web',
  read_ordinance: 'Reviewing your ordinance',
  get_code_source: 'Checking the current code',
  fetch_url: 'Reading the municipal code',
  apply_draft_edit: 'Applying your change',
  accept_draft_changes: 'Accepting the changes',
}

export const ordinanceToolLabel = (name: string): string | null =>
  ORDINANCE_TOOL_LABELS[name] ?? null
