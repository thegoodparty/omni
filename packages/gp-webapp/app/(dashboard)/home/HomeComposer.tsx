'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  IconButton,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@styleguide'
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
import { morphComposerOutOfPill } from '../shared/chatMorph'

/**
 * Home's chat box, in the page under the next thing; elsewhere the chat is
 * the sidebar's Chat pill (see shared/chatMorph). It is the open door for anything about the
 * campaign; questions about the next thing go through the card's "Chat about
 * this". Built like a place to work, not a search field: room for a few
 * lines, and a tool row with attach, past chats, voice and send. Sending opens
 * the chat drawer with the message as the candidate's first turn.
 */
const PLACEHOLDER = 'How can I help you today?'
const MIC_IDLE_LABEL = 'Record your voice'
const MIC_RECORDING_LABEL = 'Stop dictation'

export default function HomeComposer(): React.JSX.Element | null {
  const chat = useCampaignManagerChat()
  const [message, setMessage] = useState('')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  // Arriving from the sidebar, the box grows out of the Chat pill it shrank
  // into on the way out (see shared/chatMorph). A callback ref rather than a
  // mount effect, because the box itself can attach a render later than this
  // component mounts (it renders nothing until the chat is ready).
  const formRef = useCallback((node: HTMLFormElement | null) => {
    if (node) morphComposerOutOfPill(node)
  }, [])

  // Leaving Home with something typed and unsent hands it to the chat, so it
  // is waiting in the chat's input on the next open.
  const messageRef = useRef(message)
  messageRef.current = message
  const holdDraft = chat?.holdDraft
  useEffect(() => () => holdDraft?.(messageRef.current), [holdDraft])
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
        ref={formRef}
        data-chat-morph="composer"
        className="flex flex-col gap-2 rounded-2xl border border-grayscale-300 bg-card px-4 pb-3 pt-4 transition-colors lg:px-5 lg:pt-5 focus-within:border-primary"
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
          placeholder={PLACEHOLDER}
          aria-label={PLACEHOLDER}
          className="min-h-12 resize-none border-0 bg-transparent p-1 text-base shadow-none md:text-base focus-visible:ring-0"
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
        />
        <div className="flex items-center gap-1">
          {/* Each tool names itself on hover, like the history clock beside it. */}
          <Tooltip>
            <TooltipTrigger asChild>
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
            </TooltipTrigger>
            <TooltipContent side="top">Attach a file</TooltipContent>
          </Tooltip>
          <ChatHistoryPopover
            onSelect={chat.openConversation}
            chatApi={campaignManagerChatApi}
            historyKey={CAMPAIGN_MANAGER_HISTORY_KEY}
          />
          <div className="ml-auto flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <DictationMicButton
                    dictation={dictation}
                    idleLabel={MIC_IDLE_LABEL}
                    recordingLabel={MIC_RECORDING_LABEL}
                    size="medium"
                    className="static size-10"
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                {dictation.status === 'recording'
                  ? MIC_RECORDING_LABEL
                  : MIC_IDLE_LABEL}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              {/* A disabled button gets no pointer events, so the tooltip
                  hangs off a wrapper that does. */}
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <IconButton
                    type="submit"
                    aria-label="Send"
                    disabled={!message.trim()}
                    className="size-10 rounded-full bg-primary text-primary-foreground"
                  >
                    <SendIcon className="size-4" aria-hidden />
                  </IconButton>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">Send</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </form>
      <DictationFeedback dictation={dictation} />
    </div>
  )
}
