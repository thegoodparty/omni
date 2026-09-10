'use client'

import { useState } from 'react'
import { Button, cn, Input } from '@styleguide'
import { ASSISTANT_BUBBLE, AssistantRow } from '../../shared/agent-chat/chatUI'
import WideChip, { ASSISTANT_INDENT } from './WideChip'
import { categoryDisplay } from 'app/dashboard/community-issues/components/categoryDisplay'
import { useTopCommunityIssues } from '../data/use-community-issues'
import { useCreatePriority, usePrioritizeIssue } from '../data/use-priorities'

interface Props {
  /** The official's name, for the greeting. */
  firstName?: string
}

/**
 * The first onboarding step: "what are you working on?", offering the surfaced
 * community issues as choices with a write-your-own card at the bottom.
 *
 * Client-driven on purpose. The agent is not asked to run this flow, so there
 * is no new tool, no prompt rule and no widget seam in the chat body — the
 * step reads `GET /v1/community-issues` and writes through the two endpoints
 * that already exist (`prioritize` for a surfaced issue, `POST /v1/priorities`
 * for a written-in one). The agent picks the answer up on its next turn through
 * `crud_priorities`, which it already has.
 *
 * The interaction mirrors the ordinance flow's `ClarifyQuestionWidget`: option
 * cards, an always-present "write your own" card that swaps in an input, Enter
 * to submit, and a locked state once answered. It is a separate component
 * rather than a reuse because that one is bound to the clarify tool's payload
 * and its agent round-trip, and this step has neither.
 */
export default function PriorityChoiceStep({
  firstName,
}: Props): React.JSX.Element | null {
  const { data: issues, isPending, isError } = useTopCommunityIssues()
  const prioritize = usePrioritizeIssue()
  const createOwn = useCreatePriority()
  const [writingOwn, setWritingOwn] = useState(false)
  const [ownText, setOwnText] = useState('')

  const busy = prioritize.isPending || createOwn.isPending

  const submitOwn = (): void => {
    const trimmed = ownText.trim()
    if (!trimmed || busy) return
    createOwn.mutate(trimmed)
    setOwnText('')
    setWritingOwn(false)
  }

  // Nothing to offer and nothing to say yet. The step is derived from the
  // priorities list, so returning null hands the turn back to the agent's own
  // starter prompts rather than showing a half-built question.
  if (isPending) return null

  const offered = issues ?? []

  return (
    <div className="flex flex-col gap-3">
      <AssistantRow>
        <div className={ASSISTANT_BUBBLE}>
          {firstName ? `Hi ${firstName}. ` : 'Hi. '}
          What are you working on right now?
          {offered.length > 0
            ? " These are what I'm seeing come up most in your district, or tell me something else."
            : ' Tell me the problem you want to solve and I can help you move it forward.'}
        </div>
      </AssistantRow>

      <div className={cn('flex flex-col gap-2.5', ASSISTANT_INDENT)}>
        {isError && (
          <p className="text-sm text-muted-foreground">
            I could not load what your district is talking about right now. You
            can still tell me what you are working on.
          </p>
        )}

        {offered.map((issue) => {
          const { label, Icon } = categoryDisplay(issue.category)
          return (
            <WideChip
              key={issue.id}
              Icon={Icon}
              title={issue.title}
              why={issue.summary}
              impact={label}
              disabled={busy}
              onSelect={() => prioritize.mutate(issue.id)}
            />
          )
        })}

        {writingOwn ? (
          <div className="flex items-center gap-2">
            <Input
              value={ownText}
              onChange={(e) => setOwnText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submitOwn()
                }
              }}
              placeholder="What are you working on?"
              disabled={busy}
              aria-label="Describe what you are working on"
              autoFocus
            />
            <Button
              type="button"
              size="small"
              onClick={submitOwn}
              disabled={busy || ownText.trim().length === 0}
            >
              Send
            </Button>
          </div>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => setWritingOwn(true)}
            className={cn(
              'flex w-full min-h-14 items-center rounded-md border border-border',
              'bg-card px-4 py-3.5 text-left text-[15px] font-medium',
              'text-muted-foreground transition-colors duration-150',
              'hover:border-primary focus-visible:border-primary',
              'disabled:pointer-events-none disabled:opacity-50',
            )}
          >
            {offered.length > 0
              ? "It's something else..."
              : 'Tell me what you are working on...'}
          </button>
        )}
      </div>
    </div>
  )
}
