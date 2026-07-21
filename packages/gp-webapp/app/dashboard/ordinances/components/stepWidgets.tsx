import {
  OrdinanceAuthorityFindingSchema,
  OrdinanceCurrentLawSummarySchema,
  OrdinanceLegislativeHistorySchema,
  OrdinancePresentComparablesSchema,
  OrdinancePresentDraftSchema,
  type OrdinanceAuthorityFinding,
  type OrdinanceCurrentLawSummary,
  type OrdinanceLegislativeHistory,
  type OrdinancePresentComparables,
  type OrdinancePresentDraft,
} from '@goodparty_org/contracts'
import type { ChatMessageSegment } from '../../shared/agent-chat/chatClient'
import {
  segmentsToLive,
  type LiveSegment,
} from '../../shared/agent-chat/streaming'
import { InlineSegments } from '../../shared/agent-chat/chatUI'
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

export type StepWidgetInstance =
  | { tool: typeof AUTHORITY_TOOL; data: OrdinanceAuthorityFinding }
  | { tool: typeof CURRENT_LAW_TOOL; data: OrdinanceCurrentLawSummary }
  | { tool: typeof HISTORY_TOOL; data: OrdinanceLegislativeHistory }
  | { tool: typeof COMPARABLES_TOOL; data: OrdinancePresentComparables }
  | { tool: typeof DRAFT_TOOL; data: OrdinancePresentDraft }

// Record keyed by the union so tsc forces this map to stay exhaustive when a
// new widget variant is added.
const STEP_WIDGET_TOOLS: Record<StepWidgetInstance['tool'], true> = {
  [AUTHORITY_TOOL]: true,
  [CURRENT_LAW_TOOL]: true,
  [HISTORY_TOOL]: true,
  [COMPARABLES_TOOL]: true,
  [DRAFT_TOOL]: true,
}

export const isStepWidgetTool = (toolName: string): boolean =>
  toolName in STEP_WIDGET_TOOLS

// Compile-time guard: adding a StepWidgetInstance variant without a render case
// makes this fail to typecheck.
const assertNever = (widget: never): never => {
  throw new Error(`Unhandled step widget: ${JSON.stringify(widget)}`)
}

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
    case DRAFT_TOOL: {
      // A draft with an empty body carries nothing to render, so it drops like
      // a parse failure rather than occupying an empty assistant row.
      const parsed = OrdinancePresentDraftSchema.safeParse(value)
      return parsed.success && parsed.data.body.length > 0
        ? { tool: DRAFT_TOOL, data: parsed.data }
        : null
    }
    default:
      return null
  }
}

// A live widget plus the text position (chars streamed before its tool fired)
// where it belongs in the turn, so it renders inline at that seam.
export type PositionedWidget = {
  instance: StepWidgetInstance
  appearAfter: number
}

// A turn rendered as ordered blocks: runs of inline segments (text + tool pills)
// and step cards, in stream order. A card sits at the point its tool fired, so
// the lead-in text renders above it and any following prose renders below it.
type TurnBlock =
  | { kind: 'segments'; segments: LiveSegment[] }
  | { kind: 'widget'; instance: StepWidgetInstance }

// Live turn: splice each shown widget into the revealed segments at its text
// position (`appearAfter`). Gated on a fixed threshold (not the moving
// "revealDone"), so once the reveal passes `appearAfter` the card stays put and
// later text types out below it — never flashing out as more text arrives.
export function liveTurnBlocks(
  visibleSegments: LiveSegment[],
  widgets: PositionedWidget[],
  revealedTextLength: number,
): TurnBlock[] {
  const shown = widgets
    .filter((w) => revealedTextLength >= w.appearAfter)
    .sort((a, b) => a.appearAfter - b.appearAfter)
  const blocks: TurnBlock[] = []
  let run: LiveSegment[] = []
  let acc = 0
  let wi = 0
  const flushRun = (): void => {
    if (run.length > 0) {
      blocks.push({ kind: 'segments', segments: run })
      run = []
    }
  }
  const placeWidgetsUpTo = (pos: number): void => {
    for (let w = shown[wi]; w && w.appearAfter <= pos; w = shown[wi]) {
      flushRun()
      blocks.push({ kind: 'widget', instance: w.instance })
      wi++
    }
  }
  for (const seg of visibleSegments) {
    if (seg.kind !== 'text') {
      placeWidgetsUpTo(acc)
      run.push(seg)
      continue
    }
    let text = seg.text
    let segStart = acc
    for (
      let w = shown[wi];
      w && w.appearAfter <= segStart + text.length;
      w = shown[wi]
    ) {
      const at = Math.max(w.appearAfter, segStart)
      const before = text.slice(0, at - segStart)
      if (before) run.push({ kind: 'text', text: before })
      flushRun()
      blocks.push({ kind: 'widget', instance: w.instance })
      text = text.slice(at - segStart)
      segStart = at
      wi++
    }
    if (text) run.push({ kind: 'text', text })
    acc += seg.text.length
  }
  placeWidgetsUpTo(acc)
  flushRun()
  return blocks
}

// Reloaded turn: the persisted segments already carry the present_* tools at
// their stream positions, so walk them in order — text and non-widget tools
// into inline runs, widget tools as cards — to match the live interleaving.
export function persistedTurnBlocks(
  segments: ChatMessageSegment[],
  content: string,
): TurnBlock[] {
  if (segments.length === 0) {
    const live = segmentsToLive([], content)
    return live.length > 0 ? [{ kind: 'segments', segments: live }] : []
  }
  const blocks: TurnBlock[] = []
  let run: ChatMessageSegment[] = []
  // Split the segments at each widget tool; the shared segmentsToLive does the
  // text/tool projection for the non-widget runs, so those rules live in one
  // place.
  const flushRun = (): void => {
    const live = segmentsToLive(run, '')
    if (live.length > 0) blocks.push({ kind: 'segments', segments: live })
    run = []
  }
  for (const s of segments) {
    if (s.kind === 'tool' && s.toolName && isStepWidgetTool(s.toolName)) {
      const widget = parseStepWidget(s.toolName, s.payload)
      if (widget) {
        flushRun()
        blocks.push({ kind: 'widget', instance: widget })
      }
      continue
    }
    run.push(s)
  }
  flushRun()
  return blocks
}

// Render a turn's interleaved blocks: inline runs via the shared InlineSegments,
// step cards inline between them.
export function TurnBlocks({
  blocks,
  slug,
  toolLabel,
}: {
  blocks: TurnBlock[]
  slug: string
  toolLabel: (toolName: string) => string | null
}): React.JSX.Element {
  return (
    <>
      {blocks.map((block, i) =>
        block.kind === 'widget' ? (
          <StepWidgetBlocks key={i} widgets={[block.instance]} slug={slug} />
        ) : (
          <InlineSegments
            key={i}
            segments={block.segments}
            toolLabel={toolLabel}
          />
        ),
      )}
    </>
  )
}

export function StepWidgetBlocks({
  widgets,
  slug,
}: {
  widgets: StepWidgetInstance[]
  slug: string
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
          case DRAFT_TOOL:
            return <DraftReadyWidget key={i} draft={widget.data} slug={slug} />
          default:
            return assertNever(widget)
        }
      })}
    </>
  )
}
