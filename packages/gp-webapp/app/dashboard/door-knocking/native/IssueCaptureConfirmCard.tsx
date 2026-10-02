// No 'use client' of its own: RecordKnockForm is the boundary and pulls this
// into the client graph with it, so a directive here would only cost a tick on
// the ratchet (scripts/check-use-client-count.mjs) for nothing.
import { useState } from 'react'
import {
  CONSTITUENT_FEEDBACK_DESIRED_OUTCOME_MAX_LENGTH,
  CONSTITUENT_FEEDBACK_ISSUE_LABEL_MAX_LENGTH,
  type ConfirmedConstituentFeedbackIssue,
  type ConstituentFeedbackIssue,
  type ConstituentFeedbackStance,
} from '@goodparty_org/contracts'
import {
  Button,
  Input,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
  cn,
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
    none: 'No issue came up in this note.',
    issueNumber: (n: number): string => `Issue ${n}`,
    remove: 'Remove',
    removeFor: (issue: string): string => `Remove ${issue}`,
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
    none: 'No issue came up in this note.',
    issueNumber: (n: number): string => `Issue ${n}`,
    remove: 'Remove',
    removeFor: (issue: string): string => `Remove ${issue}`,
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

type ProposedIssues = { issues: ConstituentFeedbackIssue[] } | null

// One issue as the canvasser is editing it. `fromPosition` is the proposal
// it started as, sent back so the server keeps the two side by side.
type IssueDraft = {
  fromPosition: number | undefined
  issueLabel: string
  stance: ConstituentFeedbackStance | undefined
  desiredOutcome: string
}

// Whether the canvasser changed what the model proposed, never what either
// of them said: a person's words are not analytics. Removing an issue is a
// correction, and so is editing one.
export const wasCorrected = (
  proposed: ProposedIssues,
  confirmed: ConfirmedConstituentFeedbackIssue[],
): boolean => {
  const issues = proposed?.issues ?? []
  return (
    issues.length !== confirmed.length ||
    confirmed.some(
      (issue, i) =>
        issue.issueLabel !== issues[i]?.issueLabel ||
        issue.stance !== issues[i]?.stance ||
        issue.desiredOutcome !== issues[i]?.desiredOutcome,
    )
  )
}

// A failed extraction still offers one empty issue, so the canvasser can
// write down what they heard instead of losing it.
const initialDrafts = (proposed: ProposedIssues): IssueDraft[] =>
  proposed === null
    ? [
        {
          fromPosition: undefined,
          issueLabel: '',
          stance: undefined,
          desiredOutcome: '',
        },
      ]
    : proposed.issues.map((issue) => ({
        fromPosition: issue.position,
        issueLabel: issue.issueLabel,
        stance: issue.stance ?? undefined,
        desiredOutcome: issue.desiredOutcome ?? '',
      }))

// An issue left without a name is left out: there is nothing to file it
// under, and the contract refuses one.
const toConfirmed = (
  drafts: IssueDraft[],
): ConfirmedConstituentFeedbackIssue[] =>
  drafts.flatMap((draft) => {
    const issueLabel = draft.issueLabel.trim()
    if (issueLabel === '') return []
    const desiredOutcome = draft.desiredOutcome.trim()
    return [
      {
        issueLabel,
        stance: draft.stance ?? null,
        desiredOutcome: desiredOutcome === '' ? null : desiredOutcome,
        ...(draft.fromPosition === undefined
          ? {}
          : { fromPosition: draft.fromPosition }),
      },
    ]
  })

interface IssueCaptureConfirmCardProps {
  proposed: ProposedIssues
  saving: boolean
  isServe: boolean
  onConfirm: (issues: ConfirmedConstituentFeedbackIssue[]) => void
  // Absent where there is nothing to skip to: the review list leaves an
  // unconfirmed note where it is.
  onSkip?: () => void
  // The confirm button's accessible name where several cards share a page,
  // so each says which note it confirms.
  confirmLabel?: string
}

// The issues, handed back for the one person who can judge them: whoever just
// had the conversation. Confirming here is what separates a first-hand record
// from a guess, which is why it happens at the door and not in a queue later.
// Each issue can be corrected or removed. None can be added here: the
// canvasser records or types the note again instead.
export default function IssueCaptureConfirmCard({
  proposed,
  saving,
  isServe,
  onConfirm,
  onSkip,
  confirmLabel,
}: IssueCaptureConfirmCardProps) {
  const copy = isServe ? CAPTURE_COPY.serve : CAPTURE_COPY.win
  const stanceLabels = isServe ? STANCE_LABELS.serve : STANCE_LABELS.win
  const [drafts, setDrafts] = useState(() => initialDrafts(proposed))

  const update = (index: number, change: Partial<IssueDraft>) =>
    setDrafts((current) =>
      current.map((draft, i) =>
        i === index ? { ...draft, ...change } : draft,
      ),
    )
  const remove = (index: number) =>
    setDrafts((current) => current.filter((_, i) => i !== index))

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-components-input-border p-4">
      <div>
        <p className="text-sm font-semibold text-foreground">{copy.heading}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {proposed === null
            ? copy.empty
            : drafts.length === 0
              ? copy.none
              : copy.caption}
        </p>
      </div>

      {drafts.map((draft, index) => {
        const name = copy.issueNumber(index + 1)
        return (
          <div
            // The proposal an issue came from never changes while the card is
            // up, so it keys the block through removals of the ones above it.
            key={draft.fromPosition ?? 'written'}
            role="group"
            aria-label={name}
            className={cn(
              'flex flex-col gap-4',
              index > 0 && 'border-t border-components-input-border pt-4',
            )}
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className={QUESTION_LABEL_CLASSNAME}>{copy.issue}</span>
                <Button
                  variant="ghost"
                  size="small"
                  disabled={saving}
                  aria-label={copy.removeFor(draft.issueLabel.trim() || name)}
                  onClick={() => remove(index)}
                >
                  {copy.remove}
                </Button>
              </div>
              <Input
                className="mt-2"
                value={draft.issueLabel}
                maxLength={CONSTITUENT_FEEDBACK_ISSUE_LABEL_MAX_LENGTH}
                placeholder={copy.issuePlaceholder}
                onChange={(e) => update(index, { issueLabel: e.target.value })}
              />
            </div>

            <div>
              <span className={QUESTION_LABEL_CLASSNAME}>{copy.stance}</span>
              <ToggleGroup
                type="single"
                value={draft.stance ?? ''}
                onValueChange={(next) =>
                  update(index, {
                    stance: STANCE_ORDER.find((id) => id === next),
                  })
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
                value={draft.desiredOutcome}
                maxLength={CONSTITUENT_FEEDBACK_DESIRED_OUTCOME_MAX_LENGTH}
                placeholder={copy.outcomePlaceholder}
                rows={2}
                onChange={(e) =>
                  update(index, { desiredOutcome: e.target.value })
                }
              />
            </div>
          </div>
        )
      })}

      <div className="flex flex-col gap-2">
        <Button
          className="w-full"
          disabled={saving}
          aria-label={confirmLabel}
          onClick={() => onConfirm(toConfirmed(drafts))}
        >
          {saving ? 'Saving…' : copy.confirm}
        </Button>
        {/* Skipping leaves the memo and its unconfirmed issues on the record
            and moves the walk on. Nothing is lost, and reporting can tell an
            unconfirmed row from a confirmed one, so the canvasser is never
            held at a door by a question about a conversation they have
            already finished. */}
        {onSkip !== undefined && (
          <Button
            className="w-full"
            variant="outline"
            disabled={saving}
            onClick={onSkip}
          >
            {copy.skip}
          </Button>
        )}
      </div>
    </div>
  )
}
