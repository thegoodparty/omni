'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@styleguide'
import { MapPinIcon, PhoneIcon } from '@styleguide/components/ui/icons'
import type { Priority, PriorityStage } from '@goodparty_org/contracts'
import {
  PhoneBankingFlow,
  SERVE_PHONE_BANKING_SURFACE,
} from 'app/dashboard/outreach/v2/phone-banking/PhoneBankingFlow'
import { ASSISTANT_BUBBLE, AssistantRow } from '../../shared/agent-chat/chatUI'
import WideChip, { ASSISTANT_INDENT } from './WideChip'

// What talking to constituents is FOR differs by stage, so the lead-in does
// too. The two actions are the same either way — the point of asking where
// they are is that the framing changes, not the channel.
const LEAD_IN: Record<PriorityStage, string> = {
  exploring:
    'the fastest way to get your bearings is to hear it straight from the people it affects',
  gathering_input:
    'you have heard from some people already, so the next thing worth doing is widening that',
  shaping:
    'before you commit to a solution, it is worth testing it on the people who will live with it',
  ready_for_vote:
    'a vote is won before the meeting, so the next thing that moves it is talking to the people who will show up',
}

interface Props {
  priority: Priority & { stage: PriorityStage }
}

/**
 * The standing next-step push on a priority: not an onboarding step that
 * completes, but the thing the home says to move a priority forward.
 *
 * Nothing links a priority to the outreach done about it, so there is no
 * "already did this" state to derive — which is why this is a persistent
 * recommendation rather than a step in the flow.
 *
 * Phone banking mounts inline: `PhoneBankingFlow` is a controlled component
 * with no provider dependency, and Serve's surface is already exported, so the
 * flow opens over the conversation without leaving it. Door knocking cannot do
 * the same — its create wizard draws over the district map, which is a route,
 * not a drawer — so that one navigates with `?create=1`, which is exactly what
 * the Serve outreach hub's own tile does.
 *
 * Neither needs a Pro gate: on Serve the ElectedOffice row is the entitlement,
 * enforced by `@UseElectedOffice()` on the API and by the door-knocking gate
 * treating an `eo-` org as license-equivalent.
 */
export default function PriorityNextStep({
  priority,
}: Props): React.JSX.Element {
  const router = useRouter()
  const [phoneBankingOpen, setPhoneBankingOpen] = useState(false)

  return (
    <div className="flex flex-col gap-3">
      <AssistantRow>
        <div className={ASSISTANT_BUBBLE}>
          On {priority.title.toLowerCase()}, {LEAD_IN[priority.stage]}. Want to
          start there?
        </div>
      </AssistantRow>

      <div className={cn('flex flex-col gap-2.5', ASSISTANT_INDENT)}>
        <WideChip
          Icon={PhoneIcon}
          title="Call constituents about this"
          why="I can draft the script and build the call list with you, right here."
          onSelect={() => setPhoneBankingOpen(true)}
        />
        <WideChip
          Icon={MapPinIcon}
          title="Knock doors about this"
          why="Opens the district map so you can cut a turf and I will build the route."
          onSelect={() => router.push('/dashboard/door-knocking?create=1')}
        />
      </div>

      <PhoneBankingFlow
        open={phoneBankingOpen}
        onClose={() => setPhoneBankingOpen(false)}
        surface={SERVE_PHONE_BANKING_SURFACE}
      />
    </div>
  )
}
