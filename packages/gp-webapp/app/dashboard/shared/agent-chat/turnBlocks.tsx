import { Fragment } from 'react'
import type { ChatMessageSegment } from './chatClient'
import { InlineSegments } from './chatUI'
import { CLARIFY_TOOL } from './clarifyWidget'
import { segmentsToLive, type LiveSegment } from './streaming'
import type { WidgetInstance, WidgetRegistry } from './widgetRegistry'

// A live widget plus the text position (chars streamed before its tool fired)
// where it belongs in the turn, so it renders inline at that seam.
export interface PositionedWidget<Ctx> {
  instance: WidgetInstance<Ctx>
  appearAfter: number
  key?: string
}

// A turn rendered as ordered blocks: runs of inline segments (text + tool pills)
// and widgets, in stream order. A widget sits at the point its tool fired, so
// the lead-in text renders above it and any following prose renders below it.
export type TurnBlock<Ctx> =
  | { kind: 'segments'; key?: string; segments: LiveSegment[] }
  | { kind: 'widget'; key?: string; instance: WidgetInstance<Ctx> }

const SENTENCE_BREAK = /[.!?]+[*_]*["')\]]?\s+(?=[*_]*["'([]?[A-Z])/g
// "U.S. Census", "Dr. Smith", "Maple Ave. Housing": a title-case word of 2
// or 3 letters, or one with an inner dot, before a period is read as an
// abbreviation. A lone capital ("Option A.") and an all-caps acronym ("ADU.",
// "FAQ.") end sentences far more often than they abbreviate, so they don't.
const ABBREVIATION = /(?:^|\s)(?:[A-Z][a-z]{1,2}|\S*\.\S*)\.$/

// The last line goes when it ends in "?". When statements open that line,
// only the closing run of questions goes, unless the whole line is wrapped in
// emphasis, where cutting it would leave an unclosed marker.
export const withoutTrailingQuestion = (text: string): string => {
  const trimmed = text.trimEnd()
  const lineStart = trimmed.lastIndexOf('\n') + 1
  const line = trimmed.slice(lineStart)
  if (!/\?[*_]*$/.test(line)) return text
  let cut = 0
  if (!/^[*_].*[*_]$/.test(line)) {
    for (const match of line.matchAll(SENTENCE_BREAK)) {
      if (match[0].startsWith('?')) continue
      if (ABBREVIATION.test(line.slice(0, match.index + 1))) continue
      cut = match.index + match[0].length
    }
  }
  return (trimmed.slice(0, lineStart) + line.slice(0, cut)).trimEnd()
}

// A hidden clarify call left in the inline run (a surface that renders the
// widget outside the blocks) sits after the text it should be checked against.
const isClarifyCall = (s: LiveSegment): boolean =>
  s.kind === 'tool' && s.toolName === CLARIFY_TOOL

const dropTrailingQuestionFrom = <Ctx,>(
  block: TurnBlock<Ctx>,
): TurnBlock<Ctx>[] => {
  if (block.kind !== 'segments') return [block]
  let end = block.segments.length
  while (end > 0 && isClarifyCall(block.segments[end - 1]!)) end--
  const last = block.segments[end - 1]
  if (last?.kind !== 'text') return [block]
  const text = withoutTrailingQuestion(last.text)
  if (text === last.text) return [block]
  const segments: LiveSegment[] = [
    ...block.segments.slice(0, end - 1),
    ...(text ? [{ kind: 'text' as const, text }] : []),
    ...block.segments.slice(end),
  ]
  return segments.some((seg) => !isClarifyCall(seg))
    ? [{ ...block, segments }]
    : []
}

// The clarify widget shows its own question, so prose that also asks it puts
// the question on screen twice. Only the text directly above the widget is
// touched, and only its closing question.
const dropQuestionsAboveClarify = <Ctx,>(
  blocks: TurnBlock<Ctx>[],
): TurnBlock<Ctx>[] =>
  blocks.flatMap((block, i): TurnBlock<Ctx>[] => {
    const next = blocks[i + 1]
    return next?.kind === 'widget' && next.instance.toolName === CLARIFY_TOOL
      ? dropTrailingQuestionFrom(block)
      : [block]
  })

// For a surface that renders its clarify widget below the turn blocks rather
// than as one of them (the ordinance flow's live turn).
export const dropTrailingQuestion = <Ctx,>(
  blocks: TurnBlock<Ctx>[],
): TurnBlock<Ctx>[] => {
  const last = blocks[blocks.length - 1]
  return last
    ? [...blocks.slice(0, -1), ...dropTrailingQuestionFrom(last)]
    : blocks
}

// Live turn: splice each shown widget into the revealed segments at its text
// position (`appearAfter`). Gated on a fixed threshold (not the moving
// "revealDone"), so once the reveal passes `appearAfter` the widget stays put
// and later text types out below it — never flashing out as more text arrives.
export const liveTurnBlocks = <Ctx,>(
  visibleSegments: LiveSegment[],
  widgets: PositionedWidget<Ctx>[],
  revealedTextLength: number,
): TurnBlock<Ctx>[] => {
  const shown = widgets
    .filter((w) => revealedTextLength >= w.appearAfter)
    .sort((a, b) => a.appearAfter - b.appearAfter)
  const blocks: TurnBlock<Ctx>[] = []
  let run: LiveSegment[] = []
  let acc = 0
  let wi = 0
  const flushRun = (): void => {
    if (run.length > 0) {
      blocks.push({ kind: 'segments', segments: run })
      run = []
    }
  }
  const pushWidget = (w: PositionedWidget<Ctx>): void => {
    blocks.push({
      kind: 'widget',
      instance: w.instance,
      ...(w.key !== undefined && { key: w.key }),
    })
  }
  const placeWidgetsUpTo = (pos: number): void => {
    for (let w = shown[wi]; w && w.appearAfter <= pos; w = shown[wi]) {
      flushRun()
      pushWidget(w)
      wi++
    }
  }
  for (const seg of visibleSegments) {
    if (seg.kind !== 'text') {
      // Push the pill before placing any widget at this same text position, so
      // a tool-first widget (appearAfter === acc) renders below the preceding
      // research pill, not above it.
      run.push(seg)
      placeWidgetsUpTo(acc)
      continue
    }
    // Text deltas coalesce across a consumed tool call, so a widget's seam can
    // fall inside a single text segment; split it there.
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
      pushWidget(w)
      text = text.slice(at - segStart)
      segStart = at
      wi++
    }
    if (text) run.push({ kind: 'text', text })
    acc += seg.text.length
  }
  placeWidgetsUpTo(acc)
  flushRun()
  return dropQuestionsAboveClarify(blocks)
}

// Reloaded turn: the persisted segments already carry the widget tools at their
// stream positions, so walk them in order — text and ordinary tools into inline
// runs, widget tools as widgets — to match the live interleaving. With a
// `messageId`, blocks carry keys stable across re-renders.
// `surfaceWidget` is for a block whose data is not in the tool args (the
// Priorities status marker reads a replay the surface holds in state); it is
// asked first, and null falls through to the registry.
export const persistedTurnBlocks = <Ctx,>({
  registry,
  segments,
  content,
  messageId,
  conversationId,
  surfaceWidget,
}: {
  registry: WidgetRegistry<Ctx>
  segments: ChatMessageSegment[]
  content: string
  messageId?: string
  conversationId?: string | null
  surfaceWidget?: (
    segment: ChatMessageSegment,
    index: number,
  ) => WidgetInstance<Ctx> | null
}): TurnBlock<Ctx>[] => {
  if (segments.length === 0) {
    const live = segmentsToLive([], content)
    return live.length > 0
      ? [
          {
            kind: 'segments',
            segments: live,
            ...(messageId !== undefined && { key: `${messageId}-seg-0` }),
          },
        ]
      : []
  }
  const blocks: TurnBlock<Ctx>[] = []
  let run: ChatMessageSegment[] = []
  let citations = 0
  // Split the segments at each widget tool; the shared segmentsToLive does the
  // text/tool projection for the non-widget runs, so those rules live in one
  // place.
  const flushRun = (): void => {
    const live = segmentsToLive(run, '', citations)
    citations += live.filter((s) => s.kind === 'citation').length
    if (live.length > 0) {
      blocks.push({
        kind: 'segments',
        segments: live,
        ...(messageId !== undefined && {
          key: `${messageId}-seg-${blocks.length}`,
        }),
      })
    }
    run = []
  }
  segments.forEach((s, index) => {
    const surface = surfaceWidget?.(s, index)
    if (surface) {
      flushRun()
      blocks.push({
        kind: 'widget',
        instance: surface,
        ...(messageId !== undefined && {
          key: `${messageId}-widget-${index}`,
        }),
      })
      return
    }
    const entry =
      s.kind === 'tool' && s.toolName ? registry.entry(s.toolName) : undefined
    if (!entry || !s.toolName) {
      run.push(s)
      return
    }
    const instance = registry.resolve(
      {
        toolName: s.toolName,
        conversationId: conversationId ?? null,
        toolCallId: s.toolCallId ?? null,
        messageId: messageId ?? null,
        segmentIndex: index,
      },
      s.payload,
    )
    if (instance) {
      flushRun()
      blocks.push({
        kind: 'widget',
        instance,
        ...(messageId !== undefined && {
          key: `${messageId}-widget-${index}`,
        }),
      })
      return
    }
    if (entry.onParseFailure === 'inline') run.push(s)
  })
  flushRun()
  return dropQuestionsAboveClarify(blocks)
}

// Render a turn's interleaved blocks: inline runs via the shared
// InlineSegments, widgets between them rendered with the surface's context.
export const TurnBlocks = <Ctx,>({
  blocks,
  toolLabel,
  context,
  onCitationClick,
}: {
  blocks: TurnBlock<Ctx>[]
  toolLabel: (toolName: string) => string | null
  context: Ctx
  onCitationClick?: (
    attachmentId: string,
    page: number | null | undefined,
  ) => void
}): React.JSX.Element => (
  <>
    {blocks.map((block, i) =>
      block.kind === 'widget' ? (
        <Fragment key={block.key ?? i}>
          {block.instance.render(context)}
        </Fragment>
      ) : (
        <InlineSegments
          key={block.key ?? i}
          segments={block.segments}
          toolLabel={toolLabel}
          onCitationClick={onCitationClick}
        />
      ),
    )}
  </>
)
