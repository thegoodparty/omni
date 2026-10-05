'use client'

import { useRef, useState } from 'react'
import { IconButton, Textarea } from '@styleguide'
import { PlusIcon, SendIcon } from '@styleguide/components/ui/icons'
import { useCampaignManagerChat } from '../campaign-manager/CampaignManagerChatProvider'
import {
  CAMPAIGN_MANAGER_HISTORY_KEY,
  campaignManagerChatApi,
} from '../campaign-manager/campaignManagerChat'
import ChatHistoryPopover from '../chief-of-staff/components/chat/ChatHistoryPopover'
import { DictationMicButton } from '../shared/dictation/DictationMicButton'
import { useDictationAppend } from '../shared/dictation/useDictationAppend'
import { DictationFeedback } from '../briefings/shared/DictationFeedback'

/**
 * Home's chat box, in the page under the next thing rather than in the fixed
 * footer bar the other pages use. It is the open door for anything about the
 * campaign; questions about the next thing go through the card's "Chat about
 * this". Built like a place to work, not a search field: room for a few
 * lines, and a tool row with attach, past chats, voice and send. Sending opens
 * the chat drawer with the message as the candidate's first turn.
 */
const PLACEHOLDER = 'How can I help you today?'

export default function HomeComposer(): React.JSX.Element | null {
  const chat = useCampaignManagerChat()
  const [message, setMessage] = useState('')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const dictation = useDictationAppend({
    analyticsLabel: 'home_composer',
    value: message,
    onChange: setMessage,
  })

  if (!chat) return null

  const send = (): void => {
    const text = message.trim()
    if (!text) return
    if (dictation.active) void dictation.stop()
    chat.sendFromComposer(text)
    setMessage('')
  }

  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex flex-col gap-3 rounded-2xl border border-grayscale-300 bg-card px-4 pb-3 pt-4 transition-colors lg:px-5 lg:pt-5 focus-within:border-primary"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        <Textarea
          id="home-composer"
          ref={inputRef}
          rows={3}
          value={message}
          placeholder={PLACEHOLDER}
          aria-label={PLACEHOLDER}
          className="min-h-[72px] resize-none border-0 bg-transparent p-1 text-base shadow-none md:text-base focus-visible:ring-0"
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
        />
        <div className="flex items-center gap-1">
          <IconButton
            type="button"
            variant="ghost"
            size="small"
            className="size-10"
            aria-label="Attach a file"
            onClick={chat.openManager}
          >
            <PlusIcon className="size-5" aria-hidden />
          </IconButton>
          <ChatHistoryPopover
            onSelect={chat.openConversation}
            chatApi={campaignManagerChatApi}
            historyKey={CAMPAIGN_MANAGER_HISTORY_KEY}
          />
          <div className="ml-auto flex items-center gap-1">
            <DictationMicButton
              dictation={dictation}
              idleLabel="Dictate a message"
              recordingLabel="Stop dictation"
              size="medium"
              className="static size-10"
            />
            <IconButton
              type="submit"
              aria-label="Send"
              disabled={!message.trim()}
              className="size-10 rounded-full bg-primary text-primary-foreground"
            >
              <SendIcon className="size-4" aria-hidden />
            </IconButton>
          </div>
        </div>
      </form>
      <DictationFeedback dictation={dictation} />
    </div>
  )
}
