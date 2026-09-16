import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button,
  IconButton,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Textarea,
} from '@styleguide'
import {
  CheckIcon,
  CopyIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from '@styleguide/components/ui/icons'
import { reportErrorToSentry } from '@shared/sentry'
import type {
  ChatClient,
  ChatFeedbackKind,
  ChatMessageFeedbackState,
} from './chatTypes'

const COMMENT_MAX_CHARS = 2000
const COPIED_RESET_MS = 2000

const NOTE_PROMPT: Record<ChatFeedbackKind, string> = {
  positive: 'What did you like?',
  negative: 'What was wrong?',
}

type Props = {
  conversationId: string
  messageId: string
  // Copied verbatim, so the clipboard carries what the assistant actually
  // wrote rather than the rendered markup.
  content: string
  chatApi: ChatClient
  initialFeedback?: ChatMessageFeedbackState | null
}

/**
 * The per-message action bar under an assistant turn: rate it up or down, add
 * an optional note in the bubble a rating opens, or copy the reply. Ratings
 * persist against both the message and its thread; a repeat tap on the active
 * thumb clears the rating.
 */
export default function MessageActionBar({
  conversationId,
  messageId,
  content,
  chatApi,
  initialFeedback,
}: Props): React.JSX.Element | null {
  const [rating, setRating] = useState<ChatFeedbackKind | null>(
    initialFeedback?.feedback ?? null,
  )
  const [storedNote, setStoredNote] = useState<string | null>(
    initialFeedback?.comment ?? null,
  )
  const [noteFor, setNoteFor] = useState<ChatFeedbackKind | null>(null)
  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)

  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    },
    [],
  )

  const onCopy = useCallback(async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(content)
    } catch (err) {
      reportErrorToSentry(err, { surface: 'agent-chat-copy', messageId })
      return
    }
    setCopied(true)
    if (copiedTimer.current) clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS)
  }, [content, messageId])

  const vote = useCallback(
    async (target: ChatFeedbackKind): Promise<void> => {
      const previous = { rating, storedNote }
      // A repeat tap on the active thumb retracts the rating and its note.
      if (rating === target) {
        setRating(null)
        setStoredNote(null)
        setNoteFor(null)
        try {
          await chatApi.clearMessageFeedback?.({ conversationId, messageId })
        } catch (err) {
          setRating(previous.rating)
          setStoredNote(previous.storedNote)
          reportErrorToSentry(err, {
            surface: 'agent-chat-feedback',
            phase: 'clear',
            messageId,
          })
        }
        return
      }
      // Land the rating before the note so it sticks even if the bubble is
      // dismissed without saving. Flipping the thumb drops the old note — it
      // explained the rating that no longer applies.
      setRating(target)
      setStoredNote(null)
      setDraft('')
      setNoteFor(target)
      try {
        await chatApi.setMessageFeedback?.({
          conversationId,
          messageId,
          feedback: target,
          comment: null,
        })
      } catch (err) {
        setRating(previous.rating)
        setStoredNote(previous.storedNote)
        setNoteFor(null)
        reportErrorToSentry(err, {
          surface: 'agent-chat-feedback',
          phase: 'set',
          messageId,
        })
      }
    },
    [rating, storedNote, chatApi, conversationId, messageId],
  )

  const saveNote = useCallback(async (): Promise<void> => {
    if (!noteFor) return
    const trimmed = draft.trim()
    const comment = trimmed.length === 0 ? null : trimmed
    const previousNote = storedNote
    setStoredNote(comment)
    setNoteFor(null)
    try {
      await chatApi.setMessageFeedback?.({
        conversationId,
        messageId,
        feedback: noteFor,
        comment,
      })
    } catch (err) {
      setStoredNote(previousNote)
      reportErrorToSentry(err, {
        surface: 'agent-chat-feedback',
        phase: 'comment',
        messageId,
      })
    }
  }, [noteFor, draft, storedNote, chatApi, conversationId, messageId])

  // A client without the feedback routes still gets Copy, but no thumbs.
  const canRate = Boolean(
    chatApi.setMessageFeedback && chatApi.clearMessageFeedback,
  )

  return (
    <div className="flex items-center gap-0.5">
      <IconButton
        type="button"
        size="small"
        variant="ghost"
        aria-label={copied ? 'Copied' : 'Copy'}
        onClick={() => void onCopy()}
        className="text-muted-foreground hover:text-foreground"
      >
        {copied ? (
          <CheckIcon className="size-4" aria-hidden />
        ) : (
          <CopyIcon className="size-4" aria-hidden />
        )}
      </IconButton>

      {canRate ? (
        <Popover
          open={noteFor !== null}
          onOpenChange={(next) => {
            if (!next) setNoteFor(null)
          }}
        >
          <PopoverAnchor asChild>
            <span className="flex items-center gap-0.5">
              <IconButton
                type="button"
                size="small"
                variant="ghost"
                aria-label="Good response"
                aria-pressed={rating === 'positive'}
                onClick={() => void vote('positive')}
                className={
                  rating === 'positive'
                    ? 'text-success-600 hover:text-success-600'
                    : 'text-muted-foreground hover:text-foreground'
                }
              >
                <ThumbsUpIcon className="size-4" aria-hidden />
              </IconButton>
              <IconButton
                type="button"
                size="small"
                variant="ghost"
                aria-label="Bad response"
                aria-pressed={rating === 'negative'}
                onClick={() => void vote('negative')}
                className={
                  rating === 'negative'
                    ? 'text-destructive hover:text-destructive'
                    : 'text-muted-foreground hover:text-foreground'
                }
              >
                <ThumbsDownIcon className="size-4" aria-hidden />
              </IconButton>
            </span>
          </PopoverAnchor>
          <PopoverContent
            align="start"
            side="top"
            className="flex w-80 flex-col gap-3 p-4"
          >
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-foreground">
                {noteFor ? NOTE_PROMPT[noteFor] : ''}
              </p>
              <p className="text-xs text-muted-foreground">
                Optional. Your note helps us improve.
              </p>
            </div>
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add a note"
              rows={3}
              maxLength={COMMENT_MAX_CHARS}
              aria-label="Feedback note"
              className="resize-none"
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="link"
                size="small"
                onClick={() => setNoteFor(null)}
              >
                Not now
              </Button>
              <Button
                type="button"
                size="small"
                onClick={() => void saveNote()}
              >
                Save
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  )
}
