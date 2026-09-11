'use client'

import { cn } from '@styleguide'
import {
  CheckCircleIcon,
  GavelIcon,
  PencilIcon,
  UsersIcon,
} from '@styleguide/components/ui/icons'
import type { LucideIcon } from 'lucide-react'
import type { Priority, PriorityStage } from '@goodparty_org/contracts'
import {
  PROTO_ASSISTANT_BUBBLE as ASSISTANT_BUBBLE,
  ProtoAssistantRow as AssistantRow,
} from './chat/prototypeChrome'
import WideChip, { ASSISTANT_INDENT } from './WideChip'
import { useSetPriorityStage } from '../data/use-priorities'

// The four stages, in order, with the copy an official would actually use to
// describe where they are. The enum values are the contract; these are the
// question's answers.
const STAGES: {
  stage: PriorityStage
  Icon: LucideIcon
  title: string
  why: string
}[] = [
  {
    stage: 'exploring',
    Icon: PencilIcon,
    title: 'I have started on it a bit',
    why: 'Early days. I can help you figure out what to look at first.',
  },
  {
    stage: 'gathering_input',
    Icon: UsersIcon,
    title: 'I have talked to constituents about it',
    why: 'You have heard from people. I can help you turn that into a direction.',
  },
  {
    stage: 'shaping',
    Icon: CheckCircleIcon,
    title: 'I have a solution and need help shaping it',
    why: 'You know what you want to do. I can help you draft and pressure-test it.',
  },
  {
    stage: 'ready_for_vote',
    Icon: GavelIcon,
    title: 'It is going up for a vote',
    why: 'The hard part is counting votes. I can help you line up support.',
  },
]

interface Props {
  priority: Priority
}

/**
 * The second onboarding step: now that we know what the official is working on,
 * ask how far along they are.
 *
 * Client-driven like the first step, and persisted rather than remembered
 * locally — `stage` is a real column, so the agent reads it through
 * `crud_priorities` on its next turn and does not have to ask again. That is
 * the whole reason it is not in localStorage.
 */
export default function PriorityStageStep({
  priority,
}: Props): React.JSX.Element {
  const setStage = useSetPriorityStage()

  return (
    <div className="flex flex-col gap-3">
      <AssistantRow>
        <div className={ASSISTANT_BUBBLE}>
          Got it, {priority.title.toLowerCase()}. Where are you with it right
          now?
        </div>
      </AssistantRow>

      <div className={cn('flex flex-col gap-2.5', ASSISTANT_INDENT)}>
        {STAGES.map(({ stage, Icon, title, why }) => (
          <WideChip
            key={stage}
            Icon={Icon}
            title={title}
            why={why}
            disabled={setStage.isPending}
            onSelect={() => setStage.mutate({ id: priority.id, stage })}
          />
        ))}
      </div>
    </div>
  )
}
