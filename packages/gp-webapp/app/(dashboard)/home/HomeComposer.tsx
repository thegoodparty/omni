'use client'

import { useEffect, useRef, useState } from 'react'
import { Button, IconButton, Textarea } from '@styleguide'
import { SendIcon, XMarkIcon } from '@styleguide/components/ui/icons'
import type { CampaignTrackerTask } from 'gpApi/api-endpoints'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useUser } from '@shared/hooks/useUser'
import { useCampaignManagerChat } from '../campaign-manager/CampaignManagerChatProvider'
import { useNextThing } from './useNextThing'

// Questions a candidate would ask about this kind of task. They fill the box
// and wait for the candidate to send, so each one can be edited first.
const suggestionsFor = (
  task: CampaignTrackerTask,
  needsFiling: boolean,
): string[] => {
  if (needsFiling) {
    return [
      'How many signatures do I need?',
      'Where do I file, and what does it cost?',
      'Help me plan how to collect signatures',
    ]
  }
  switch (task.flowType) {
    case 'text':
    case 'robocall':
      return [
        'Draft this message for me',
        'Who should I send it to?',
        'When is the best time to send it?',
      ]
    case 'events':
      return [
        'Help me prepare for this event',
        'What should I say when I speak?',
        'Who should I invite?',
      ]
    case 'doorKnocking':
    case 'phoneBanking':
      return [
        'Write me a script',
        'Which voters should I start with?',
        'How many can I reach in an evening?',
      ]
    default:
      return [
        'Help me get this done',
        'Why does this matter for my race?',
        'How long will this take?',
      ]
  }
}

/**
 * Home's chat box, in the page directly under the next thing rather than in
 * the fixed footer bar the other pages use. While "About" is on, what the
 * candidate sends is framed as being about that task; clearing it turns the
 * box back into a general question. Sending opens the chat drawer with the
 * message as the candidate's first turn.
 */
export default function HomeComposer(): React.JSX.Element | null {
  const chat = useCampaignManagerChat()
  const [user] = useUser()
  const { next, needsFiling, eventProps } = useNextThing()
  const [message, setMessage] = useState('')
  const [aboutTask, setAboutTask] = useState(true)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  // A new next thing is a new topic: put the label back on it.
  const nextId = next?.id ?? null
  useEffect(() => {
    setAboutTask(true)
  }, [nextId])

  if (!chat) return null

  const scoped = Boolean(next && aboutTask)
  const firstName = user?.firstName || undefined

  const send = (): void => {
    const text = message.trim()
    if (!text) return
    if (scoped && next) {
      if (eventProps) {
        trackEvent(EVENTS.Dashboard.CampaignPlan.NextThingStarted, {
          ...eventProps,
          via: 'chat',
        })
      }
      chat.sendFromComposer(`About my next step, "${next.title}": ${text}`)
    } else {
      chat.sendFromComposer(text)
    }
    setMessage('')
  }

  const placeholder = scoped
    ? 'Ask anything about this step'
    : firstName
      ? `Hi ${firstName}, how can I help?`
      : 'How can I help?'

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-col gap-2 rounded-2xl border border-grayscale-300 bg-card p-3 shadow-sm focus-within:border-primary"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        {scoped && next && (
          <span className="inline-flex max-w-full items-center gap-1 self-start rounded-full bg-primary-light py-0.5 pl-3 pr-1 text-xs font-semibold text-primary-dark">
            <span className="truncate">About: {next.title}</span>
            <IconButton
              type="button"
              variant="ghost"
              size="small"
              className="!h-5 !w-5 rounded-full"
              aria-label="Ask about something else"
              onClick={() => {
                setAboutTask(false)
                inputRef.current?.focus()
              }}
            >
              <XMarkIcon className="size-3" aria-hidden />
            </IconButton>
          </span>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            id="home-composer"
            ref={inputRef}
            rows={2}
            value={message}
            placeholder={placeholder}
            aria-label={placeholder}
            className="min-h-0 flex-1 resize-none border-0 bg-transparent p-1 shadow-none focus-visible:ring-0"
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                send()
              }
            }}
          />
          <IconButton
            type="submit"
            aria-label="Send"
            disabled={!message.trim()}
            className="shrink-0 rounded-full"
          >
            <SendIcon className="size-4" aria-hidden />
          </IconButton>
        </div>
      </form>

      {scoped && next && (
        <div className="grid gap-2 sm:grid-cols-3">
          {suggestionsFor(next, needsFiling).map((suggestion) => (
            <Button
              key={suggestion}
              type="button"
              variant="outline"
              className="h-auto justify-start whitespace-normal rounded-xl px-3 py-2.5 text-left text-sm font-medium"
              onClick={() => {
                setMessage(suggestion)
                inputRef.current?.focus()
              }}
            >
              {suggestion}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
