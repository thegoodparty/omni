'use client'
import { Button } from '@styleguide'
import Body2 from '@shared/typography/Body2'
import useChat from 'app/dashboard/campaign-assistant/components/useChat'
import { MdAutoAwesome } from 'react-icons/md'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'

interface Prompt {
  label: string
  prompt: string
}

const prompts: Prompt[] = [
  {
    label: 'Campaign Strategy',
    prompt: 'Can you help me with my campaign strategy?',
  },
  {
    label: 'Crafting a why statement',
    prompt:
      'Help me craft a why statement for my campaign. Ask me questions and keep a running draft going.',
  },
  {
    label: 'Voter Data',
    prompt: 'I need help with voter data.',
  },
  {
    label: 'Writing Content',
    prompt: 'I need help writing content.',
  },
]

const EmptyChat = (): React.JSX.Element => {
  const { handleNewInput } = useChat()

  const handleClick = (prompt: Prompt) => {
    // Mirror ChatInput's send event so a first message via a suggested prompt
    // is counted like a typed one, not lost.
    trackEvent(EVENTS.AIAssistant.AskQuestion, { text: prompt.prompt })
    handleNewInput(prompt.prompt)
  }
  return (
    <div className="text-center w-full h-full flex items-center justify-center">
      <div>
        <div className="flex justify-center text-indigo-500 mb-6">
          <MdAutoAwesome size={48} />
        </div>
        <Body2>
          Ask me anything related to your campaign. Or click a topic below:
        </Body2>
        <div className="flex flex-wrap justify-center gap-2 mt-4">
          {prompts.map((prompt) => (
            <Button
              key={prompt.label}
              variant="neutral"
              size="small"
              onClick={() => handleClick(prompt)}
            >
              {prompt.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default EmptyChat
