// No 'use client' of its own: RecordKnockForm is the boundary and pulls this
// into the client graph with it, so a directive here would only cost a tick on
// the ratchet (scripts/check-use-client-count.mjs) for nothing.
import { useState } from 'react'
import {
  CONSTITUENT_FEEDBACK_DESIRED_OUTCOME_MAX_LENGTH,
  CONSTITUENT_FEEDBACK_ISSUE_LABEL_MAX_LENGTH,
  type ConstituentFeedbackStance,
  type ConstituentFeedbackTriple,
} from '@goodparty_org/contracts'
import {
  Button,
  Input,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
} from '@styleguide'

// Rendered for a candidate's canvasser and an elected official's, so the copy
// is mode-keyed (docs/product-vocabulary.md) and the Serve branch is where the
// vocabulary gate reads it. The two read the same today because nothing here
// names the person on the other side of the door: Win must never say
// constituent, and Serve must never say voter.
const CAPTURE_COPY = {
  win: {
    heading: 'Is this right?',
    caption: 'Fix anything that is off. It takes one tap.',
    issue: 'Issue',
    issuePlaceholder: 'What they talked about',
    stance: 'Where they stand',
    outcome: 'What they want',
    outcomePlaceholder: 'What would fix it for them',
    confirm: 'Looks right',
    skip: 'Skip',
    empty: 'We could not pull anything out. Add it yourself or skip.',
  },
  serve: {
    heading: 'Is this right?',
    caption: 'Fix anything that is off. It takes one tap.',
    issue: 'Issue',
    issuePlaceholder: 'What they talked about',
    stance: 'Where they stand',
    outcome: 'What they want',
    outcomePlaceholder: 'What would fix it for them',
    confirm: 'Looks right',
    skip: 'Skip',
    empty: 'We could not pull anything out. Add it yourself or skip.',
  },
}

const STANCE_LABELS: Record<
  'win' | 'serve',
  Record<ConstituentFeedbackStance, string>
> = {
  win: {
    supports: 'For it',
    opposes: 'Against it',
    mixed: 'Mixed',
    unclear: 'Unclear',
  },
  serve: {
    supports: 'For it',
    opposes: 'Against it',
    mixed: 'Mixed',
    unclear: 'Unclear',
  },
}

const STANCE_ORDER: ConstituentFeedbackStance[] = [
  'supports',
  'opposes',
  'mixed',
  'unclear',
]

// Borrowed verbatim from RecordKnockForm so the confirm step reads as the last
// rung of the same ladder rather than a different control set.
const PILL_ITEM_CLASSNAME =
  'h-[34px] whitespace-nowrap rounded-full border border-components-input-border bg-transparent px-3 text-sm font-medium text-foreground data-[state=on]:border-tertiary-dark data-[state=on]:bg-tertiary-dark data-[state=on]:text-tertiary-foreground data-[state=on]:hover:bg-tertiary-dark/90'

const QUESTION_LABEL_CLASSNAME =
  'text-xs font-semibold uppercase tracking-[0.03em] text-muted-foreground'

interface IssueCaptureConfirmCardProps {
  proposed: ConstituentFeedbackTriple | null
  saving: boolean
  isServe: boolean
  onConfirm: (triple: ConstituentFeedbackTriple) => void
  onSkip: () => void
}

// The triple, handed back for the one person who can judge it: whoever just
// had the conversation. Confirming here is what separates a first-hand record
// from a guess, which is why it happens at the door and not in a queue later.
export default function IssueCaptureConfirmCard({
  proposed,
  saving,
  isServe,
  onConfirm,
  onSkip,
}: IssueCaptureConfirmCardProps) {
  const copy = isServe ? CAPTURE_COPY.serve : CAPTURE_COPY.win
  const stanceLabels = isServe ? STANCE_LABELS.serve : STANCE_LABELS.win
  const [issueLabel, setIssueLabel] = useState(proposed?.issueLabel ?? '')
  const [stance, setStance] = useState<ConstituentFeedbackStance | undefined>(
    proposed?.stance ?? undefined,
  )
  const [desiredOutcome, setDesiredOutcome] = useState(
    proposed?.desiredOutcome ?? '',
  )

  const trimmedIssue = issueLabel.trim()
  const trimmedOutcome = desiredOutcome.trim()

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-components-input-border p-4">
      <div>
        <p className="text-sm font-semibold text-foreground">{copy.heading}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {proposed === null ? copy.empty : copy.caption}
        </p>
      </div>

      <div>
        <span className={QUESTION_LABEL_CLASSNAME}>{copy.issue}</span>
        <Input
          className="mt-2"
          value={issueLabel}
          maxLength={CONSTITUENT_FEEDBACK_ISSUE_LABEL_MAX_LENGTH}
          placeholder={copy.issuePlaceholder}
          onChange={(e) => setIssueLabel(e.target.value)}
        />
      </div>

      <div>
        <span className={QUESTION_LABEL_CLASSNAME}>{copy.stance}</span>
        <ToggleGroup
          type="single"
          value={stance ?? ''}
          onValueChange={(next) =>
            setStance(STANCE_ORDER.find((id) => id === next) ?? undefined)
          }
          aria-label={copy.stance}
          className="mt-2 flex flex-wrap justify-start gap-2"
        >
          {STANCE_ORDER.map((option) => (
            <ToggleGroupItem
              key={option}
              value={option}
              className={PILL_ITEM_CLASSNAME}
            >
              {stanceLabels[option]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div>
        <span className={QUESTION_LABEL_CLASSNAME}>{copy.outcome}</span>
        <Textarea
          className="mt-2 min-h-16"
          value={desiredOutcome}
          maxLength={CONSTITUENT_FEEDBACK_DESIRED_OUTCOME_MAX_LENGTH}
          placeholder={copy.outcomePlaceholder}
          rows={2}
          onChange={(e) => setDesiredOutcome(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Button
          className="w-full"
          disabled={saving}
          onClick={() =>
            onConfirm({
              issueLabel: trimmedIssue === '' ? null : trimmedIssue,
              stance: stance ?? null,
              desiredOutcome: trimmedOutcome === '' ? null : trimmedOutcome,
            })
          }
        >
          {saving ? 'Saving…' : copy.confirm}
        </Button>
        {/* Skipping leaves the memo and its unconfirmed triple on the record
            and moves the walk on. Nothing is lost, and reporting can tell an
            unconfirmed row from a confirmed one, so the canvasser is never
            held at a door by a question about a conversation they have
            already finished. */}
        <Button
          className="w-full"
          variant="outline"
          disabled={saving}
          onClick={onSkip}
        >
          {copy.skip}
        </Button>
      </div>
    </div>
  )
}
