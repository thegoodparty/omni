'use client'

import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { SearchIcon, SparklesIcon } from '@styleguide/components/ui/icons'
import type { LiveSegment } from './streaming'

// Shared presentation for the agent chat surfaces (Chief of Staff, ordinance
// flow, ...). One source of truth for the assistant bubble, markdown rendering,
// the in-progress tool "shimmer" pills, and the avatar so every scope's chat
// reads the same. Feature-specific structured widgets (e.g. the ordinance
// clarify question) render additively alongside these in the assistant column.

// Markdown-in-a-bubble. The !block / !inline / !whitespace-normal overrides
// neutralize the chat container's flex layout so prose, lists, headings and
// tables render cleanly (same set the briefing chat uses).
export const ASSISTANT_BUBBLE =
  'self-start max-w-full rounded-2xl bg-muted px-3 py-2 text-sm text-foreground ' +
  'space-y-2 [&>:first-child]:mt-0 [&>:last-child]:mb-0 ' +
  '[&_p]:!block [&_p]:!flex-none [&_p]:!whitespace-normal ' +
  '[&_strong]:!inline [&_strong]:font-semibold [&_em]:!inline [&_em]:italic ' +
  '[&_a]:!inline [&_a]:underline [&_code]:!inline [&_code]:rounded ' +
  '[&_code]:bg-foreground/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs ' +
  '[&_li]:!list-item [&_li]:my-0 [&_ul]:!block [&_ul]:list-disc [&_ul]:pl-5 ' +
  '[&_ul]:space-y-1 [&_ol]:!block [&_ol]:list-decimal [&_ol]:pl-5 ' +
  '[&_ol]:space-y-1 [&_h1]:!block [&_h1]:text-base [&_h1]:font-semibold ' +
  '[&_h2]:!block [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:!block ' +
  '[&_h3]:text-sm [&_h3]:font-semibold [&_table]:!table [&_table]:!w-full ' +
  '[&_table]:!border-collapse [&_table]:my-2 [&_thead]:!table-header-group ' +
  '[&_tbody]:!table-row-group [&_tr]:!table-row [&_tr]:!border-b ' +
  '[&_tr]:border-foreground/15 [&_th]:!table-cell [&_th]:px-2 [&_th]:py-1.5 ' +
  '[&_th]:text-left [&_th]:font-semibold [&_th]:!border-b-2 ' +
  '[&_th]:!border-foreground/30 [&_td]:!table-cell [&_td]:px-2 [&_td]:py-1.5 ' +
  '[&_td]:align-top'

export function AssistantAvatar(): React.JSX.Element {
  return (
    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
      <SparklesIcon className="size-3.5" aria-hidden />
    </span>
  )
}

// An assistant turn: avatar + a vertical column of blocks (bubbles, tool pills,
// structured widgets), matching the streaming and reloaded layouts.
export function AssistantRow({
  children,
}: {
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex max-w-full items-start gap-2 self-start">
      <AssistantAvatar />
      <div className="flex min-w-0 max-w-full flex-col gap-2">{children}</div>
    </div>
  )
}

export function AssistantMarkdown({
  children,
}: {
  children: string
}): React.JSX.Element {
  return (
    <div className={ASSISTANT_BUBBLE}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  )
}

// A single tool-call pill. `running` wraps the label in the shimmer "wave"
// (global styleguide class) while the tool is in flight.
export function ToolPill({
  label,
  running = false,
}: {
  label: string
  running?: boolean
}): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <SearchIcon className="size-3" aria-hidden />
      {running ? <span className="text-shimmer">{label}</span> : label}
    </span>
  )
}

// A row of tool pills (one wrap group), used for a `tool` segment block.
export function ToolPillRow({
  labels,
  running = false,
}: {
  labels: string[]
  running?: boolean
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-1.5">
      {labels.map((label, i) => (
        // Index in the key: the same tool can run twice in a turn (e.g. two
        // web searches), so labels are not unique on their own.
        <ToolPill key={`${label}-${i}`} label={label} running={running} />
      ))}
    </div>
  )
}

// Render a turn's segments in stream order: text as markdown bubbles, tool
// calls as inline pills, so a search/read pill sits between the sentences it
// interrupted instead of stacked in a row above the whole reply. `toolLabel`
// maps a tool name to its pill label (return null to hide a tool, e.g. a
// bookkeeping tool or one rendered as its own widget). Consecutive tool
// segments coalesce into one pill row, which shimmers while any tool in it is
// still `running`. Shared by the live turn (running set/cleared as tools fly)
// and reloaded history (persisted segments, never running).
export function InlineSegments({
  segments,
  toolLabel,
}: {
  segments: LiveSegment[]
  toolLabel: (toolName: string) => string | null
}): React.JSX.Element {
  const blocks: ReactNode[] = []
  let pendingPills: string[] = []
  let pendingRunning = false
  const flushPills = (key: string): void => {
    if (pendingPills.length > 0) {
      blocks.push(
        <ToolPillRow
          key={`pills-${key}`}
          labels={pendingPills}
          running={pendingRunning}
        />,
      )
      pendingPills = []
      pendingRunning = false
    }
  }
  segments.forEach((seg, i) => {
    if (seg.kind === 'tool') {
      const label = toolLabel(seg.toolName)
      if (label) {
        pendingPills.push(label)
        if (seg.running) pendingRunning = true
      }
      return
    }
    flushPills(String(i))
    if (seg.text) {
      blocks.push(
        <AssistantMarkdown key={`text-${i}`}>{seg.text}</AssistantMarkdown>,
      )
    }
  })
  flushPills('end')
  return <>{blocks}</>
}
