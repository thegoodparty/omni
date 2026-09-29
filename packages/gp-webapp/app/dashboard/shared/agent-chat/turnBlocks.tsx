import { Fragment } from 'react'
import type { ChatMessageSegment } from './chatClient'
import { InlineSegments } from './chatUI'
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
  return blocks
}

// Reloaded turn: the persisted segments already carry the widget tools at their
// stream positions, so walk them in order — text and ordinary tools into inline
// runs, widget tools as widgets — to match the live interleaving. With a
// `messageId`, blocks carry keys stable across re-renders.
export const persistedTurnBlocks = <Ctx,>({
  registry,
  segments,
  content,
  messageId,
  conversationId,
}: {
  registry: WidgetRegistry<Ctx>
  segments: ChatMessageSegment[]
  content: string
  messageId?: string
  conversationId?: string | null
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
  // Split the segments at each widget tool; the shared segmentsToLive does the
  // text/tool projection for the non-widget runs, so those rules live in one
  // place.
  const flushRun = (): void => {
    const live = segmentsToLive(run, '')
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
  return blocks
}

// Render a turn's interleaved blocks: inline runs via the shared
// InlineSegments, widgets between them rendered with the surface's context.
export const TurnBlocks = <Ctx,>({
  blocks,
  toolLabel,
  context,
}: {
  blocks: TurnBlock<Ctx>[]
  toolLabel: (toolName: string) => string | null
  context: Ctx
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
        />
      ),
    )}
  </>
)
