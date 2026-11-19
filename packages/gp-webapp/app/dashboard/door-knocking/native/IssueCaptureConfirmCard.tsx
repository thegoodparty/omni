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
import {
  PanelDrawerBody,
  PanelDrawerFooter,
  PanelDrawerHeader,
} from './PanelDrawer'
import { LengthCounter } from 'app/dashboard/shared/compose/LengthCounter'

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

// One issue as the canvasser is editing it. `fromIssueId` is the proposed
// issue it started as, sent back so the server keeps that row, and the
// model's proposal on it, beside the answer.
type IssueDraft = {
  fromIssueId: string | undefined
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
          fromIssueId: undefined,
          issueLabel: '',
          stance: undefined,
          desiredOutcome: '',
        },
      ]
    : proposed.issues.map((issue) => ({
        fromIssueId: issue.id,
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
        ...(draft.fromIssueId === undefined
          ? {}
          : { fromIssueId: draft.fromIssueId }),
      },
    ]
  })

type CaptureCopy = (typeof CAPTURE_COPY)['win']

const captionFor = (
  copy: CaptureCopy,
  proposed: ProposedIssues,
  drafts: IssueDraft[],
): string =>
  proposed === null
    ? copy.empty
    : drafts.length === 0
      ? copy.none
      : copy.caption

// The card's state, one place for the issues the step renders.
const useCaptureDrafts = (proposed: ProposedIssues, isServe: boolean) => {
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
  return { copy, stanceLabels, drafts, update, remove }
}

interface IssueBlocksProps {
  copy: CaptureCopy
  stanceLabels: Record<ConstituentFeedbackStance, string>
  drafts: IssueDraft[]
  saving: boolean
  update: (index: number, change: Partial<IssueDraft>) => void
  remove: (index: number) => void
}

const IssueBlocks = ({
  copy,
  stanceLabels,
  drafts,
  saving,
  update,
  remove,
}: IssueBlocksProps) => (
  <>
    {drafts.map((draft, index) => {
      const name = copy.issueNumber(index + 1)
      return (
        <div
          // The issue a block came from never changes while the card is up,
          // so it keys the block through removals of the ones above it.
          key={draft.fromIssueId ?? 'written'}
          role="group"
          aria-label={name}
          className={cn(
            'flex flex-col gap-4',
            index > 0 && 'border-t border-components-input-border pt-4',
          )}
        >
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className={QUESTION_LABEL_CLASSNAME}>
                {drafts.length > 1 ? name : copy.issue}
              </span>
              <Button
                variant="ghost"
                size="small"
                // Pulled into the label row's height and onto the input's
                // right edge, so the ghost padding does not push the row
                // taller than the other labels or inset the word.
                className="-my-2 -mr-4 text-muted-foreground"
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
            <LengthCounter
              className="mt-1"
              length={draft.issueLabel.length}
              max={CONSTITUENT_FEEDBACK_ISSUE_LABEL_MAX_LENGTH}
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
  </>
)

interface ConfirmActionsProps {
  copy: CaptureCopy
  drafts: IssueDraft[]
  saving: boolean
  onConfirm: (issues: ConfirmedConstituentFeedbackIssue[]) => void
  onSkip: () => void
}

const ConfirmActions = ({
  copy,
  drafts,
  saving,
  onConfirm,
  onSkip,
}: ConfirmActionsProps) => (
  <div className="flex flex-col gap-2">
    <Button
      className="w-full"
      disabled={saving}
      onClick={() => onConfirm(toConfirmed(drafts))}
    >
      {saving ? 'Saving…' : copy.confirm}
    </Button>
    {/* Skipping saves the note with no issues and moves the walk on: its
        words still go into the summary, so the canvasser is never held at a
        door by a question about a conversation they have already
        finished. */}
    <Button
      className="w-full"
      variant="outline"
      disabled={saving}
      onClick={onSkip}
    >
      {copy.skip}
    </Button>
  </div>
)

interface IssueCaptureConfirmStepProps {
  proposed: ProposedIssues
  saving: boolean
  isServe: boolean
  onConfirm: (issues: ConfirmedConstituentFeedbackIssue[]) => void
  onSkip: () => void
}

// The same card as a step of the knock's or the call's `PanelDrawer`, the
// frame the questions were answered in, so the issues get the whole surface
// on a phone and the two buttons stay pinned to the bottom of the viewport.
// The frame's dismiss is the caller's Skip: the knock or call is already
// saved, so closing can only mean moving on.
export const IssueCaptureConfirmStep = ({
  proposed,
  saving,
  isServe,
  onConfirm,
  onSkip,
}: IssueCaptureConfirmStepProps) => {
  const { copy, stanceLabels, drafts, update, remove } = useCaptureDrafts(
    proposed,
    isServe,
  )
  return (
    <>
      <PanelDrawerHeader
        title={copy.heading}
        description={captionFor(copy, proposed, drafts)}
      />
      <PanelDrawerBody>
        <IssueBlocks
          copy={copy}
          stanceLabels={stanceLabels}
          drafts={drafts}
          saving={saving}
          update={update}
          remove={remove}
        />
      </PanelDrawerBody>
      <PanelDrawerFooter>
        <ConfirmActions
          copy={copy}
          drafts={drafts}
          saving={saving}
          onConfirm={onConfirm}
          onSkip={onSkip}
        />
      </PanelDrawerFooter>
    </>
  )
}
