import {
  OrdinanceAuthorityFindingSchema,
  OrdinanceCurrentLawSummarySchema,
  OrdinanceLegislativeHistorySchema,
  OrdinancePresentComparablesSchema,
  OrdinancePresentDraftSchema,
} from '@goodparty_org/contracts'
import {
  createWidgetRegistry,
  defineWidgetTool,
} from '../../shared/agent-chat/widgetRegistry'
import AuthorityFindingWidget from './AuthorityFindingWidget'
import ComparablesWidget from './ComparablesWidget'
import CurrentLawSummaryWidget from './CurrentLawSummaryWidget'
import DraftReadyWidget from './DraftReadyWidget'
import LegislativeHistoryWidget from './LegislativeHistoryWidget'

// The present_* tools the agent calls to render a step's finding as a
// structured widget. Args/segment payloads parse against the contracts schema;
// a failed parse drops the widget silently (same policy as the clarify
// widget), leaving the turn's prose intact.
export const AUTHORITY_TOOL = 'present_authority_finding'
export const CURRENT_LAW_TOOL = 'present_current_law_summary'
export const HISTORY_TOOL = 'present_legislative_history'
export const COMPARABLES_TOOL = 'present_comparables'
export const DRAFT_TOOL = 'present_draft'

export type OrdinanceWidgetContext = { slug: string }

// The finding cards that carry no ordinance context, so another chat can
// register them as they are: the priority chat shows peer cities, current
// code and legal authority on the same cards.
export const findingWidgetTools = [
  defineWidgetTool({
    toolName: AUTHORITY_TOOL,
    parse: (args) => {
      const parsed = OrdinanceAuthorityFindingSchema.safeParse(args)
      return parsed.success ? parsed.data : null
    },
    render: (finding) => <AuthorityFindingWidget finding={finding} />,
  }),
  defineWidgetTool({
    toolName: CURRENT_LAW_TOOL,
    parse: (args) => {
      const parsed = OrdinanceCurrentLawSummarySchema.safeParse(args)
      return parsed.success ? parsed.data : null
    },
    render: (summary) => <CurrentLawSummaryWidget summary={summary} />,
  }),
  defineWidgetTool({
    toolName: COMPARABLES_TOOL,
    parse: (args) => {
      const parsed = OrdinancePresentComparablesSchema.safeParse(args)
      if (!parsed.success) return null
      const { intro, comparables, takeaway } = parsed.data
      return comparables.length > 0 || intro || takeaway ? parsed.data : null
    },
    render: (presentation) => <ComparablesWidget presentation={presentation} />,
  }),
]

export const ordinanceWidgets = createWidgetRegistry<OrdinanceWidgetContext>([
  ...findingWidgetTools,
  defineWidgetTool({
    toolName: HISTORY_TOOL,
    parse: (args) => {
      // Valid but content-less payloads drop like parse failures so they never
      // occupy an assistant row or suppress the working shimmer.
      const parsed = OrdinanceLegislativeHistorySchema.safeParse(args)
      return parsed.success && parsed.data.entries.length > 0
        ? parsed.data
        : null
    },
    render: (history) => <LegislativeHistoryWidget history={history} />,
  }),
  defineWidgetTool({
    toolName: DRAFT_TOOL,
    parse: (args) => {
      // A draft with an empty body carries nothing to render, so it drops like
      // a parse failure rather than occupying an empty assistant row.
      const parsed = OrdinancePresentDraftSchema.safeParse(args)
      return parsed.success && parsed.data.body.length > 0 ? parsed.data : null
    },
    render: (draft, { slug }: OrdinanceWidgetContext) => (
      <DraftReadyWidget draft={draft} slug={slug} />
    ),
  }),
])
