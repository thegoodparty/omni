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

export const isStepWidgetTool = (toolName: string): boolean =>
  toolName === AUTHORITY_TOOL ||
  toolName === CURRENT_LAW_TOOL ||
  toolName === HISTORY_TOOL ||
  toolName === COMPARABLES_TOOL

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
      const parsed = OrdinanceLegislativeHistorySchema.safeParse(value)
      return parsed.success ? { tool: HISTORY_TOOL, data: parsed.data } : null
    }
    case COMPARABLES_TOOL: {
      const parsed = OrdinancePresentComparablesSchema.safeParse(value)
      return parsed.success
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
