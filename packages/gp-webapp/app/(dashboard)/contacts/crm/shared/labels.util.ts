// The Lovable design reads filter labels in sentence case ("Political
// party") while filters.config.ts stores title case — and that config is
// also rendered as-is by door-knocking's own filter surfaces (WhoStep,
// TurfDetailsSheet), so the transform happens at CRM render/summary time.
// Shared by VoterFileStep's group labels and buildFilterSummary's clauses.
export const sentenceCase = (label: string) =>
  label.charAt(0).toUpperCase() + label.slice(1).toLowerCase()
