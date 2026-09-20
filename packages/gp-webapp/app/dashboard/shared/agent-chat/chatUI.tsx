'use client'

import type { Ref, ReactNode } from 'react'
import { useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn, GoodPartyOrgLogo, IconButton, Textarea } from '@styleguide'
import {
  FolderOpenIcon,
  PaperclipIcon,
  SearchIcon,
  SendIcon,
  SparklesIcon,
  XMarkIcon,
} from '@styleguide/components/ui/icons'
import type { LiveSegment } from './streaming'
import ChatPill from '../ai-chat/ChatPill'
import { DictationMicButton } from '../dictation/DictationMicButton'
import type { UseDictationAppendResult } from '../dictation/useDictationAppend'
import type { ChatAttachmentState } from './chatAttachments-api'

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
  '[&_pre]:!block [&_pre]:overflow-x-auto [&_pre]:rounded-md ' +
  '[&_pre]:bg-foreground/10 [&_pre]:p-3 [&_pre]:my-1 [&_pre_code]:!block ' +
  '[&_pre_code]:!bg-transparent [&_pre_code]:!px-0 [&_pre_code]:!py-0 ' +
  '[&_pre_code]:!rounded-none ' +
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

// The agent's face is the GoodParty mark, not a generic AI glyph. Neutral
// circle (not the primary tint) so the multicolor logo reads cleanly.
export function AssistantAvatar(): React.JSX.Element {
  return (
    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-background">
      <GoodPartyOrgLogo className="h-3 w-3.5" />
    </span>
  )
}

// An assistant turn: avatar + a vertical column of blocks (bubbles, tool pills,
// structured widgets), matching the streaming and reloaded layouts.
export function AssistantRow({
  children,
  fullWidth = false,
}: {
  children: ReactNode
  /**
   * Let the column take the whole chat width instead of shrinking to its
   * content. For a turn carrying a card that is read rather than spoken — a
   * map — where a bubble's width is the wrong measure. Bubbles inside keep
   * their own `self-start`, so only a child that asks for the width takes it.
   */
  fullWidth?: boolean
}): React.JSX.Element {
  return (
    <div
      className={`flex max-w-full items-start gap-2 ${
        fullWidth ? 'w-full' : 'self-start'
      }`}
    >
      <AssistantAvatar />
      <div
        className={`flex min-w-0 max-w-full flex-col gap-2 ${
          fullWidth ? 'flex-1' : ''
        }`}
      >
        {children}
      </div>
    </div>
  )
}

// CommonMark turns any line indented 4+ spaces into a code block, so model
// output that leaks leading indentation renders prose as a grey code box.
// Strip that indentation outside fenced (```) blocks before rendering.
// Trade-off: deeply nested list items (indented 4+ spaces) also flatten to a
// single level — acceptable for chat prose, where stray code boxes are worse.
const normalizeMarkdown = (md: string): string => {
  let inFence = false
  return md
    .split('\n')
    .map((line) => {
      if (/^\s*(`{3,}|~{3,})/.test(line)) {
        inFence = !inFence
        return line
      }
      return inFence ? line : line.replace(/^ {4,}/, '')
    })
    .join('\n')
}

// The markdown core with no chrome: normalized source + the shared plugins.
// Use inside a caller's own bubble (a turn that also renders tool pills in the
// same bubble); AssistantMarkdown wraps this in the standard bubble.
export function ChatMarkdown({
  children,
}: {
  children: string
}): React.JSX.Element {
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>
      {normalizeMarkdown(children)}
    </ReactMarkdown>
  )
}

export function AssistantMarkdown({
  children,
}: {
  children: string
}): React.JSX.Element {
  return (
    <div className={ASSISTANT_BUBBLE}>
      <ChatMarkdown>{children}</ChatMarkdown>
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

// A single attachment chip shown above the textarea while awaiting send.
function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: ChatAttachmentState
  onRemove: (id: string) => void
}): React.JSX.Element {
  const statusLine =
    attachment.status === 'processing'
      ? attachment.pageCount !== null
        ? `Reading, ${attachment.pageCount} pages`
        : 'Reading...'
      : attachment.status === 'failed'
        ? `Failed: ${attachment.failureReason ?? 'unknown error'}`
        : null

  return (
    <span className="inline-flex max-w-[180px] shrink-0 items-center gap-1 rounded-full bg-foreground/10 px-2 py-0.5 text-xs text-muted-foreground">
      <PaperclipIcon className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{statusLine ?? attachment.fileName}</span>
      <button
        type="button"
        aria-label={`Remove ${attachment.fileName}`}
        onClick={() => onRemove(attachment.id)}
        className="ml-0.5 shrink-0 rounded-full hover:text-foreground"
      >
        <XMarkIcon className="size-3" aria-hidden />
      </button>
    </span>
  )
}

// Inline URL input shown when the user picks "link" from the paperclip menu.
function AttachLinkInput({
  onSubmit,
  onCancel,
  onChooseFile,
}: {
  onSubmit: (url: string) => void
  onCancel: () => void
  // When provided, renders a "Choose file" button that opens the file picker.
  onChooseFile?: () => void
}): React.JSX.Element {
  const [url, setUrl] = useState('')
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' && url.trim()) {
      e.preventDefault()
      onSubmit(url.trim())
    } else if (e.key === 'Escape') {
      onCancel()
    }
  }
  return (
    <div className="flex items-center gap-1 px-1 py-1">
      {onChooseFile ? (
        <IconButton
          type="button"
          aria-label="Choose file"
          onClick={onChooseFile}
          className="shrink-0 rounded-full"
          size="small"
        >
          <FolderOpenIcon className="size-4" aria-hidden />
        </IconButton>
      ) : null}
      <input
        autoFocus
        type="url"
        placeholder="Paste a URL..."
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={handleKeyDown}
        className="min-w-0 flex-1 rounded-full border border-border bg-transparent px-3 py-1 text-sm focus:outline-none"
        aria-label="Attachment URL"
      />
      <IconButton
        type="button"
        aria-label="Attach link"
        disabled={!url.trim()}
        onClick={() => url.trim() && onSubmit(url.trim())}
        className="shrink-0 rounded-full"
        size="small"
      >
        <SendIcon className="size-4" aria-hidden />
      </IconButton>
      <IconButton
        type="button"
        aria-label="Cancel link"
        onClick={onCancel}
        className="shrink-0 rounded-full"
        size="small"
      >
        <XMarkIcon className="size-4" aria-hidden />
      </IconButton>
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
//
// Pass `attachments`, `onAttachFile`, `onAttachLink`, and `onRemoveAttachment`
// to enable the paperclip affordance (chief_of_staff scope only, gated by the
// serve-chat-attachments flag). `guardAcknowledged`/`onGuardAcknowledge`
// control the one-time safety notice shown above the form.
export function ChatComposer({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder = 'Ask me any questions about this...',
  inputRef,
  dictation,
  leadingSlot,
  ariaLabel,
  attachments,
  onAttachFile,
  onAttachLink,
  onRemoveAttachment,
  guardAcknowledged,
  onGuardAcknowledge,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  disabled?: boolean
  placeholder?: string
  inputRef?: Ref<HTMLTextAreaElement>
  dictation?: UseDictationAppendResult
  // Rendered at the pill's leading edge, before the input (e.g. a
  // conversation-history popover). Omit for the plain composer.
  leadingSlot?: ReactNode
  // Accessible name for the input. Omit to fall back to the placeholder.
  ariaLabel?: string
  // Attachment props — omit entirely to hide the paperclip affordance.
  attachments?: ChatAttachmentState[]
  onAttachFile?: (file: File) => void
  onAttachLink?: (url: string) => void
  onRemoveAttachment?: (attachmentId: string) => void
  // Guard copy notice. Show when `false`; hide permanently after acknowledge.
  guardAcknowledged?: boolean
  onGuardAcknowledge?: () => void
}): React.JSX.Element {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // linkMode: false = closed, 'link' = URL input open
  const [linkMode, setLinkMode] = useState(false)

  const attachmentsEnabled = attachments !== undefined && !!onAttachFile

  // A textarea keeps Enter for newlines, so submit is wired by hand: Enter
  // sends, Shift+Enter inserts a break, and the Enter that commits an IME
  // candidate (CJK and other composed input) must not send. The guard mirrors
  // the send button's disabled state: the old input relied on a disabled
  // default button to block Enter form-submission, so an empty or
  // mid-dictation Enter must stay a no-op here (not every caller's onSubmit
  // guards an empty send).
  const submit = (): void => {
    if (disabled || dictation?.active || value.trim().length === 0) return
    onSubmit()
  }
  const onComposerKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
  ): void => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    e.preventDefault()
    submit()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    if (file && onAttachFile) {
      onAttachFile(file)
      // Reset so the same file can be re-selected after removal.
      e.target.value = ''
    }
  }

  const handleLinkSubmit = (url: string): void => {
    setLinkMode(false)
    onAttachLink?.(url)
  }

  const chipRow =
    attachments && attachments.length > 0 ? (
      <div className="flex flex-wrap gap-1 px-1 pt-1">
        {attachments.map((a) => (
          <AttachmentChip
            key={a.id}
            attachment={a}
            onRemove={onRemoveAttachment ?? (() => undefined)}
          />
        ))}
      </div>
    ) : null

  const controls = (
    <>
      {leadingSlot}
      <Textarea
        ref={inputRef}
        autoGrow
        rows={1}
        maxRows={6}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onComposerKeyDown}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={disabled}
        className="min-w-0 flex-1 border-0 bg-transparent px-2 py-2.5 text-sm leading-snug shadow-none focus-visible:ring-0"
      />
      {attachmentsEnabled ? (
        <IconButton
          type="button"
          aria-label="Attach file or link"
          disabled={disabled}
          onClick={() => setLinkMode((m) => !m)}
          className="static shrink-0 rounded-full"
        >
          <PaperclipIcon className="size-5" aria-hidden />
        </IconButton>
      ) : null}
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

  const guardBanner =
    attachmentsEnabled && guardAcknowledged === false ? (
      <div
        role="note"
        className="mb-1 flex items-center justify-between gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground"
      >
        <span>
          Don&apos;t upload closed-session, privileged, or active-litigation
          material.
        </span>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onGuardAcknowledge}
          className="shrink-0 rounded-full hover:text-foreground"
        >
          <XMarkIcon className="size-3.5" aria-hidden />
        </button>
      </div>
    ) : null

  const fileInput = attachmentsEnabled ? (
    <input
      ref={fileInputRef}
      type="file"
      accept=".pdf,.docx,.txt,image/jpeg,image/png"
      className="hidden"
      onChange={handleFileChange}
      aria-hidden
      tabIndex={-1}
    />
  ) : null

  // rounded-3xl reads as a pill at the one-line min height and stays a sane
  // rounded rectangle once the composer grows; items-end keeps the send button
  // on the last line of a multiline draft.
  if (dictation) {
    return (
      <>
        {guardBanner}
        {fileInput}
        <form onSubmit={handleSubmit}>
          <ChatPill
            rounded="3xl"
            innerClassName="flex-col gap-0 py-1 pr-1 pl-4"
          >
            {chipRow}
            {linkMode ? (
              <AttachLinkInput
                onSubmit={handleLinkSubmit}
                onCancel={() => setLinkMode(false)}
                onChooseFile={() => {
                  setLinkMode(false)
                  fileInputRef.current?.click()
                }}
              />
            ) : null}
            <div className="flex w-full items-end gap-1">{controls}</div>
          </ChatPill>
        </form>
      </>
    )
  }

  return (
    <>
      {guardBanner}
      {fileInput}
      <form
        className="flex min-h-12 flex-col gap-0 rounded-3xl border border-border bg-card py-1 pr-1 pl-4"
        onSubmit={handleSubmit}
      >
        {chipRow}
        {linkMode ? (
          <AttachLinkInput
            onSubmit={handleLinkSubmit}
            onCancel={() => setLinkMode(false)}
            onChooseFile={() => {
              setLinkMode(false)
              fileInputRef.current?.click()
            }}
          />
        ) : null}
        <div className="flex items-end gap-1">{controls}</div>
      </form>
    </>
  )
}
