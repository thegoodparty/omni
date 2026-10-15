'use client'

import { POLL_TOPICS, type PollTopic } from '@goodparty_org/contracts'
import { Card, cn } from '@styleguide'
import { ChevronRightIcon } from '@styleguide/components/ui/icons'
import { Intro } from '../social/Intro'
import { SERVE_POLL_TOPIC_COPY } from './pollCopy'

interface PollTopicStepProps {
  selected: PollTopic | null
  onSelect: (topic: PollTopic) => void
}

// Picking a card is the advance, so the flow renders no footer CTA here.
export const PollTopicStep = ({ selected, onSelect }: PollTopicStepProps) => (
  <div className="space-y-6">
    <Intro
      channel="poll"
      title={SERVE_POLL_TOPIC_COPY.title}
      body={SERVE_POLL_TOPIC_COPY.body}
    />
    <div className="space-y-3">
      {POLL_TOPICS.map((topic) => (
        <Card
          key={topic.id}
          role="button"
          tabIndex={0}
          aria-pressed={topic.id === selected}
          onClick={() => onSelect(topic.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onSelect(topic.id)
            }
          }}
          className={cn(
            'cursor-pointer flex-row items-center justify-between gap-3 rounded-lg p-4 transition-colors',
            topic.id === selected
              ? 'border-primary'
              : 'hover:border-primary/50',
          )}
        >
          <span className="font-medium text-foreground">{topic.label}</span>
          <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />
        </Card>
      ))}
    </div>
  </div>
)
