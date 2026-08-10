'use client'

import type { Ref, ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn, IconButton, Textarea } from '@styleguide'
import {
  SearchIcon,
  SendIcon,
  SparklesIcon,
} from '@styleguide/components/ui/icons'
import type { LiveSegment } from './streaming'
import ChatPill from '../ai-chat/ChatPill'
import { DictationMicButton } from '../../briefings/shared/DictationMicButton'
import type { UseDictationAppendResult } from '../../briefings/shared/useDictationAppend'

// Module-level so react-markdown gets a stable plugins identity across the
// per-tick re-renders of a streaming turn (a fresh [remarkGfm] each render
// would defeat its internal memoization).
const REMARK_PLUGINS = [remarkGfm]

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
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{children}</ReactMarkdown>
    </div>
  )
}

// Markdown for card body text (an authority explanation, a comparable's outcome,
// ...). Renders inline emphasis, links, lists, and code with the card's own text
// styling — no chat-bubble background. `className` carries the field's size and
// color so the markdown inherits them.
export function CardMarkdown({
  children,
  className,
}: {
  children: string
  className?: string
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'space-y-2 [&_p]:m-0 [&_strong]:font-semibold [&_em]:italic ' +
          '[&_a]:underline [&_ul]:my-0 [&_ul]:list-disc [&_ul]:pl-5 ' +
          '[&_ol]:my-0 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0 ' +
          '[&_code]:rounded [&_code]:bg-foreground/10 [&_code]:px-1 ' +
          '[&_code]:py-0.5 [&_code]:text-xs',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>{children}</ReactMarkdown>
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

// A user's message bubble, right-aligned. `whitespace-pre-wrap` preserves the
// line breaks a user typed (and the seeded passage quotes the draft chat sends).
export function UserBubble({
  children,
}: {
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="self-end rounded-2xl bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
      {children}
    </div>
  )
}

// The "working" shimmer shown while the assistant is thinking but nothing is on
// screen yet. `label` names what it is doing when known (e.g. a tool generating).
export function ThinkingRow({
  label = 'Thinking...',
}: {
  label?: string
}): React.JSX.Element {
  return (
    <div className="w-fit self-start rounded-2xl bg-muted px-3 py-2 text-sm">
      <span className="text-shimmer-muted">{label}</span>
    </div>
  )
}

// The message composer: a pill-shaped input with a send button. The consumer
// owns the value and clears it on submit; `onSubmit` fires on Enter or the
// button, and the button is disabled while empty. Pass `dictation` (from
// useDictationAppend, wired to the same value/onChange) for the agent variant:
// it adds a voice-input mic, the branded AI send icon, and the animated
// gradient border shared with Chief of Staff and the draft launcher. Omit it
// and the composer is plain — no mic, send arrow, simple border.
export function ChatComposer({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder = 'Ask me any questions about this...',
  inputRef,
  dictation,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  disabled?: boolean
  placeholder?: string
  inputRef?: Ref<HTMLTextAreaElement>
  dictation?: UseDictationAppendResult
}): React.JSX.Element {
  // A textarea keeps Enter for newlines, so submit is wired by hand: Enter
  // sends, Shift+Enter inserts a break, and the Enter that commits an IME
  // candidate (CJK and other composed input) must not send. The dictation
  // guard matches the send button so a send can't drop words still being
  // spoken; each caller's onSubmit keeps its own empty-message guard.
  const submit = (): void => {
    if (dictation?.active) return
    onSubmit()
  }
  const onComposerKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
  ): void => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    e.preventDefault()
    submit()
  }
  const controls = (
    <>
      <Textarea
        ref={inputRef}
        autoGrow
        rows={1}
        maxRows={6}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onComposerKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className="min-w-0 flex-1 border-0 bg-transparent px-2 py-2.5 text-sm leading-snug shadow-none focus-visible:ring-0"
      />
      {dictation ? (
        <DictationMicButton
          dictation={dictation}
          idleLabel="Dictate a message"
          recordingLabel="Stop dictation"
          disabled={disabled}
          size="medium"
          className="static shrink-0 rounded-full"
        />
      ) : null}
      <IconButton
        type="submit"
        className="shrink-0 rounded-full"
        disabled={disabled || !!dictation?.active || value.trim().length === 0}
        aria-label="Send"
      >
        {dictation ? (
          <SparklesIcon className="size-5" aria-hidden />
        ) : (
          <SendIcon className="size-5" aria-hidden />
        )}
      </IconButton>
    </>
  )
  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    submit()
  }
  // rounded-3xl reads as a pill at the one-line min height and stays a sane
  // rounded rectangle once the composer grows; items-end keeps the send button
  // on the last line of a multiline draft.
  return dictation ? (
    <form onSubmit={handleSubmit}>
      <ChatPill rounded="3xl" innerClassName="items-end gap-1 py-1 pr-1 pl-4">
        {controls}
      </ChatPill>
    </form>
  ) : (
    <form
      className="flex min-h-12 items-end gap-1 rounded-3xl border border-border bg-card py-1 pr-1 pl-4"
      onSubmit={handleSubmit}
    >
      {controls}
    </form>
  )
}
