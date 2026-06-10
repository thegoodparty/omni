// Single source of truth for the campaign-plan section order, titles, and
// numbering. Both the on-screen plan (`components/PlanSections.tsx`) and the
// downloadable PDF (`pdf/CampaignPlanPdfDocument.tsx`) derive their ordering,
// titles, and 1-based numbering from this list so the two views can't drift
// apart. Order matches the ClickUp campaign-plan template (the product
// source of truth).

export type PlanSectionKey =
  | 'executiveSummary'
  | 'strategicLandscape'
  | 'electoralGoals'
  | 'voterInsights'
  | 'resources'
  | 'timeline'
  | 'community'
  | 'voterContact'
  | 'measurement'
  | 'methodology'
  | 'glossary'

export interface PlanSectionDef {
  key: PlanSectionKey
  title: string
  // No section is currently optional — Sizing Up Your Race (the old
  // Strategic Landscape) is templated from race data, so it always has
  // content. The mechanism stays in case a future section needs to hide.
  optional?: boolean
}

export const PLAN_SECTION_ORDER: readonly PlanSectionDef[] = [
  { key: 'executiveSummary', title: 'Welcome to Your Campaign' },
  { key: 'strategicLandscape', title: 'Sizing Up Your Race' },
  { key: 'electoralGoals', title: 'Your Key Numbers' },
  { key: 'voterInsights', title: 'What Your Voters Care About' },
  { key: 'resources', title: "What You'll Need: Money and Time" },
  { key: 'timeline', title: 'Your Campaign Timeline' },
  { key: 'community', title: 'Community Events and Local Press' },
  { key: 'voterContact', title: 'Your Voter Contact Plan' },
  { key: 'measurement', title: 'Tracking Your Progress' },
  { key: 'methodology', title: 'Methodology and Data Sources' },
  { key: 'glossary', title: 'Glossary' },
]

export interface NumberedPlanSection extends PlanSectionDef {
  number: number
}

// Returns the visible sections in order, each carrying its 1-based display
// number. When Strategic Landscape is hidden, the sections after it shift up
// so numbering stays contiguous (1, 2, 3 … with no gap).
export const getNumberedPlanSections = (
  showStrategicLandscape: boolean,
): NumberedPlanSection[] =>
  PLAN_SECTION_ORDER.filter(
    (section) => showStrategicLandscape || !section.optional,
  ).map((section, index) => ({ ...section, number: index + 1 }))
