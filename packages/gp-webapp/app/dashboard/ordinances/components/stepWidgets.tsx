import {
  OrdinanceAuthorityFindingSchema,
  OrdinanceCurrentLawSummarySchema,
  OrdinanceLegislativeHistorySchema,
  OrdinancePresentComparablesSchema,
  type OrdinanceAuthorityFinding,
  type OrdinanceCurrentLawSummary,
  type OrdinanceLegislativeHistory,
  type OrdinancePresentComparables,
} from '@goodparty_org/contracts'
import type { ChatMessageSegment } from '../../shared/agent-chat/chatClient'
import AuthorityFindingWidget from './AuthorityFindingWidget'
import ComparablesWidget from './ComparablesWidget'
import CurrentLawSummaryWidget from './CurrentLawSummaryWidget'
import LegislativeHistoryWidget from './LegislativeHistoryWidget'

// The present_* tools the agent calls to render a step's finding as a
// structured widget. Args/segment payloads parse against the contracts schema;
// a failed parse drops the widget silently (same policy as the clarify
// widget), leaving the turn's prose intact.
export const AUTHORITY_TOOL = 'present_authority_finding'
export const CURRENT_LAW_TOOL = 'present_current_law_summary'
export const HISTORY_TOOL = 'present_legislative_history'
export const COMPARABLES_TOOL = 'present_comparables'

export type StepWidgetInstance =
  | { tool: typeof AUTHORITY_TOOL; data: OrdinanceAuthorityFinding }
  | { tool: typeof CURRENT_LAW_TOOL; data: OrdinanceCurrentLawSummary }
  | { tool: typeof HISTORY_TOOL; data: OrdinanceLegislativeHistory }
  | { tool: typeof COMPARABLES_TOOL; data: OrdinancePresentComparables }

// Record keyed by the union so tsc forces this map to stay exhaustive when a
// new widget variant is added.
const STEP_WIDGET_TOOLS: Record<StepWidgetInstance['tool'], true> = {
  [AUTHORITY_TOOL]: true,
  [CURRENT_LAW_TOOL]: true,
  [HISTORY_TOOL]: true,
  [COMPARABLES_TOOL]: true,
}

export const isStepWidgetTool = (toolName: string): boolean =>
  toolName in STEP_WIDGET_TOOLS

export const parseStepWidget = (
  toolName: string,
  value: unknown,
): StepWidgetInstance | null => {
  switch (toolName) {
    case AUTHORITY_TOOL: {
      const parsed = OrdinanceAuthorityFindingSchema.safeParse(value)
      return parsed.success ? { tool: AUTHORITY_TOOL, data: parsed.data } : null
    }
    case CURRENT_LAW_TOOL: {
      const parsed = OrdinanceCurrentLawSummarySchema.safeParse(value)
      return parsed.success
        ? { tool: CURRENT_LAW_TOOL, data: parsed.data }
        : null
    }
    case HISTORY_TOOL: {
      // Valid but content-less payloads drop like parse failures so they never
      // occupy an assistant row or suppress the working shimmer.
      const parsed = OrdinanceLegislativeHistorySchema.safeParse(value)
      return parsed.success && parsed.data.entries.length > 0
        ? { tool: HISTORY_TOOL, data: parsed.data }
        : null
    }
    case COMPARABLES_TOOL: {
      const parsed = OrdinancePresentComparablesSchema.safeParse(value)
      if (!parsed.success) return null
      const { intro, comparables, takeaway } = parsed.data
      return comparables.length > 0 || intro || takeaway
        ? { tool: COMPARABLES_TOOL, data: parsed.data }
        : null
    }
    default:
      return null
  }
}

// Widgets a persisted assistant turn carries, in tool-call order.
export const parseStepWidgets = (
  segments: ChatMessageSegment[],
): StepWidgetInstance[] =>
  segments.flatMap((s) => {
    if (s.kind !== 'tool' || !s.toolName) return []
    const widget = parseStepWidget(s.toolName, s.payload)
    return widget ? [widget] : []
  })

export function StepWidgetBlocks({
  widgets,
}: {
  widgets: StepWidgetInstance[]
}): React.JSX.Element | null {
  if (widgets.length === 0) return null
  return (
    <>
      {widgets.map((widget, i) => {
        switch (widget.tool) {
          case AUTHORITY_TOOL:
            return <AuthorityFindingWidget key={i} finding={widget.data} />
          case CURRENT_LAW_TOOL:
            return <CurrentLawSummaryWidget key={i} summary={widget.data} />
          case HISTORY_TOOL:
            return <LegislativeHistoryWidget key={i} history={widget.data} />
          case COMPARABLES_TOOL:
            return <ComparablesWidget key={i} presentation={widget.data} />
        }
      })}
    </>
  )
}
