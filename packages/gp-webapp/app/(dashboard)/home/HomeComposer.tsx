'use client'

import { useRef, useState } from 'react'
import { IconButton, Textarea } from '@styleguide'
import { SendIcon } from '@styleguide/components/ui/icons'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useUser } from '@shared/hooks/useUser'
import { useCampaignManagerChat } from '../campaign-manager/CampaignManagerChatProvider'
import { useNextThing } from './useNextThing'
import { askAboutStep } from './nextThingCopy'

/**
 * Home's chat box, in the page under the next thing rather than in the fixed
 * footer bar the other pages use. The card right above it sets the topic, so a
 * question sent here is framed as being about that step (the model can still
 * answer anything). Sending opens the chat drawer with it as the candidate's
 * first turn.
 */
export default function HomeComposer(): React.JSX.Element | null {
  const chat = useCampaignManagerChat()
  const [user] = useUser()
  const { next, eventProps } = useNextThing()
  const [message, setMessage] = useState('')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  if (!chat) return null

  const firstName = user?.firstName || undefined

  const send = (): void => {
    const text = message.trim()
    if (!text) return
    if (next) {
      if (eventProps) {
        trackEvent(EVENTS.Dashboard.CampaignPlan.NextThingStarted, {
          ...eventProps,
          via: 'chat',
        })
      }
      chat.sendFromComposer(askAboutStep(next.title, text))
    } else {
      chat.sendFromComposer(text)
    }
    setMessage('')
  }

  const placeholder = next
    ? 'Ask anything about this step'
    : firstName
      ? `Hi ${firstName}, how can I help?`
      : 'How can I help?'

  return (
    <form
      className="flex items-end gap-2 rounded-2xl border border-grayscale-300 bg-card p-3 shadow-sm focus-within:border-primary"
      onSubmit={(event) => {
        event.preventDefault()
        send()
      }}
    >
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
    </form>
  )
}
