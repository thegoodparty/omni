import { Fragment } from 'react'
import type { ChatMessageSegment } from './chatClient'
import { InlineSegments } from './chatUI'
import { isQuestionTool } from './clarifyWidget'
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

const SENTENCE_BREAK = /[.!?]+[*_]*["')\]]?\s+(?=[*_]*["'([]?[A-Za-z])/g
// "U.S. Census", "Dr. Smith", "Gov. Stein", "Maple Ave. Housing": a known
// title, office or street abbreviation, or single letters joined by dots ("U.S.", "e.g."), before a
// period is read as an abbreviation. Every other word ends its sentence, since
// a short word like "On." does far more often than not.
const ABBREVIATION =
  /(?:^|\s)(?:Dr|Mr|Ms|Mrs|St|Mt|Ave|Blvd|Rd|Ln|Jr|Sr|Gov|Sen|Rep|Dept|vs|(?:[A-Za-z]\.)+[A-Za-z])\.$/

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
      if (!/[!.]/.test(match[0])) continue
      if (ABBREVIATION.test(line.slice(0, match.index + 1))) continue
      cut = match.index + match[0].length
    }
  } else if (lineStart === 0 && line.search(SENTENCE_BREAK) !== -1) {
    // A bolded line that carries context ahead of its question, with nothing
    // above it to keep: cutting inside would leave an unclosed marker, and
    // dropping it would lose the context, so it stays whole.
    return text
  }

  // A cut inside a bold span would leave its marker open, so it backs off to
  // where that span starts.
  if ((line.slice(0, cut).match(/\*\*/g) ?? []).length % 2 !== 0) {
    cut = line.lastIndexOf('**', cut)
  }
  return (trimmed.slice(0, lineStart) + line.slice(0, cut)).trimEnd()
}

const dropTrailingQuestionFrom = <Ctx,>(
  block: TurnBlock<Ctx>,
): TurnBlock<Ctx>[] => {
  if (block.kind !== 'segments') return [block]
  const last = block.segments[block.segments.length - 1]
  if (last?.kind !== 'text') return [block]
  const text = withoutTrailingQuestion(last.text)
  if (text === last.text) return [block]
  const segments: LiveSegment[] = [
    ...block.segments.slice(0, -1),
    ...(text ? [{ kind: 'text' as const, text }] : []),
  ]
  return segments.length > 0 ? [{ ...block, segments }] : []
}

// The clarify widget shows its own question, so prose that also asks it puts
// the question on screen twice. Only the text directly above the widget is
// touched, and only its closing question.
const dropQuestionsAboveClarify = <Ctx,>(
  blocks: TurnBlock<Ctx>[],
): TurnBlock<Ctx>[] =>
  blocks.flatMap((block, i): TurnBlock<Ctx>[] => {
    const next = blocks[i + 1]
    return next?.kind === 'widget' && isQuestionTool(next.instance.toolName)
      ? dropTrailingQuestionFrom(block)
      : [block]
  })

type WidgetBlock<Ctx> = Extract<TurnBlock<Ctx>, { kind: 'widget' }>

// An 'afterProse' or 'belowTurn' widget renders once per turn per tool: the
// last call that parses, in the place of that tool's first call.
const oncePerTool = <Ctx,>(blocks: WidgetBlock<Ctx>[]): WidgetBlock<Ctx>[] => {
  const byTool = new Map<string, WidgetBlock<Ctx>>()
  for (const block of blocks) byTool.set(block.instance.toolName, block)
  return [...byTool.values()]
}

// Live turn: splice each shown widget into the revealed segments at its text
// position (`appearAfter`). Gated on a fixed threshold (not the moving
// "revealDone"), so once the reveal passes `appearAfter` the widget stays put
// and later text types out below it — never flashing out as more text arrives.
// An 'afterProse' or 'belowTurn' widget waits on the same threshold and then
// goes after every other block.
export const liveTurnBlocks = <Ctx,>(
  visibleSegments: LiveSegment[],
  widgets: PositionedWidget<Ctx>[],
  revealedTextLength: number,
): TurnBlock<Ctx>[] => {
  const revealed = widgets.filter((w) => revealedTextLength >= w.appearAfter)
  const shown = revealed
    .filter((w) => w.instance.placement === 'inline')
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
  const trailing = oncePerTool(
    revealed
      .filter((w) => w.instance.placement !== 'inline')
      .map(
        (w): WidgetBlock<Ctx> => ({
          kind: 'widget',
          instance: w.instance,
          ...(w.key !== undefined && { key: w.key }),
        }),
      ),
  )
  return dropQuestionsAboveClarify([...blocks, ...trailing])
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
  const trailing: WidgetBlock<Ctx>[] = []
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
      const block: WidgetBlock<Ctx> = {
        kind: 'widget',
        instance,
        ...(messageId !== undefined && {
          key: `${messageId}-widget-${index}`,
        }),
      }
      if (instance.placement === 'inline') {
        flushRun()
        blocks.push(block)
      } else {
        trailing.push(block)
      }
      return
    }
    if (entry.onParseFailure === 'inline') run.push(s)
  })
  flushRun()
  return dropQuestionsAboveClarify([...blocks, ...oncePerTool(trailing)])
}

// Render a turn's interleaved blocks: inline runs via the shared
// InlineSegments, widgets between them rendered with the surface's context.
// Inside the assistant row it renders everything but the 'belowTurn' widgets;
// with `belowTurn`, under the row, only those.
export const TurnBlocks = <Ctx,>({
  blocks,
  toolLabel,
  context,
  onCitationClick,
  belowTurn = false,
}: {
  blocks: TurnBlock<Ctx>[]
  toolLabel: (toolName: string) => string | null
  context: Ctx
  onCitationClick?: (
    attachmentId: string,
    page: number | null | undefined,
  ) => void
  belowTurn?: boolean
}): React.JSX.Element => (
  <>
    {blocks.map((block, i) => {
      if (block.kind === 'segments') {
        return belowTurn ? null : (
          <InlineSegments
            key={block.key ?? i}
            segments={block.segments}
            toolLabel={toolLabel}
            onCitationClick={onCitationClick}
          />
        )
      }
      if ((block.instance.placement === 'belowTurn') !== belowTurn) return null
      return (
        <Fragment key={block.key ?? i}>
          {block.instance.render(context)}
        </Fragment>
      )
    })}
  </>
)
