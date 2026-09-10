'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@styleguide'
import {
  FileTextIcon,
  MapPinIcon,
  PhoneIcon,
} from '@styleguide/components/ui/icons'
import type { Priority, PriorityStage } from '@goodparty_org/contracts'
import {
  PhoneBankingFlow,
  SERVE_PHONE_BANKING_SURFACE,
} from 'app/dashboard/outreach/v2/phone-banking/PhoneBankingFlow'
import { ASSISTANT_BUBBLE, AssistantRow } from '../../shared/agent-chat/chatUI'
import WideChip, { ASSISTANT_INDENT } from './WideChip'
import {
  ordinanceHref,
  usePriorityOrdinance,
} from '../data/use-priority-ordinance'

// What talking to constituents is FOR differs by stage, so the lead-in does
// too. The two outreach actions are the same either way — the point of asking
// where they are is that the framing changes, not the channel.
const LEAD_IN: Record<PriorityStage, string> = {
  exploring:
    'the fastest way to get your bearings is to hear it straight from the people it affects',
  gathering_input:
    'you have heard from some people already, so the next thing worth doing is widening that',
  shaping:
    'the next thing that moves it is getting the language down and testing it on the people who will live with it',
  ready_for_vote:
    'a vote is won before the meeting, so the next things that move it are the text and the count',
}

// Drafting only belongs on the board once there is something to draft. Before
// that the official is still working out what the problem is, and an ordinance
// CTA would be asking them to write a solution they have not landed on.
const DRAFTING_STAGES: PriorityStage[] = ['shaping', 'ready_for_vote']

interface Props {
  priority: Priority & { stage: PriorityStage }
}

/**
 * The standing next-step push on a priority: not an onboarding step that
 * completes, but the thing the home says to move a priority forward.
 *
 * Nothing links a priority to the outreach done about it, so there is no
 * "already did this" state to derive — which is why this is a persistent
 * recommendation rather than a step in the flow. The ordinance CTA is the
 * exception: an ordinance seeded from a priority carries the priority's title
 * as its `goalText`, so an in-flight draft can be found and resumed instead of
 * minting a second one on every visit.
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
  const ordinance = usePriorityOrdinance(priority, (href) => router.push(href))

  const showDrafting = DRAFTING_STAGES.includes(priority.stage)

  return (
    <div className="flex flex-col gap-3">
      <AssistantRow>
        <div className={ASSISTANT_BUBBLE}>
          On {priority.title.toLowerCase()}, {LEAD_IN[priority.stage]}. Want to
          start there?
        </div>
      </AssistantRow>

      <div className={cn('flex flex-col gap-2.5', ASSISTANT_INDENT)}>
        {/* Held back until we know whether a draft already exists, so the CTA
            never offers to start a second one. */}
        {showDrafting &&
          !ordinance.isPending &&
          (ordinance.existing ? (
            <WideChip
              Icon={FileTextIcon}
              title="Pick your draft back up"
              why="You already have an ordinance going for this. I can take you back to where you left it."
              href={ordinanceHref(ordinance.existing)}
            />
          ) : (
            <WideChip
              Icon={FileTextIcon}
              title="Draft the ordinance"
              why="I will research the authority you are acting under, find comparable laws, and write a first draft with you."
              disabled={ordinance.isStarting}
              onSelect={ordinance.start}
            />
          ))}

        {ordinance.hasError && (
          <p className="text-sm text-destructive">
            I could not start an ordinance from this. Please try again.
          </p>
        )}

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
