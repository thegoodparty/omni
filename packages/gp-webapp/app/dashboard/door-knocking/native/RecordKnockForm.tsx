'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  DoorKnockOutcome,
  DoorKnockStatus,
  FollowUpAnswer,
  RoutePayloadTarget,
  SupportAnswer,
  WillVoteAnswer,
} from '@goodparty_org/contracts'
import { Button, Textarea, ToggleGroup, ToggleGroupItem } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useDictationAppend } from 'app/dashboard/shared/dictation/useDictationAppend'
import { DictationMicButton } from 'app/dashboard/shared/dictation/DictationMicButton'
import { DictationFeedback } from 'app/dashboard/briefings/shared/DictationFeedback'
import { useDoorKnockingServeMode } from './doorKnockingSurface'
import {
  ANSWER_OPTIONS,
  ENGAGEMENT_OPTIONS,
  ENGAGEMENT_QUESTION,
  FOLLOW_UP_OPTIONS,
  FOLLOW_UP_QUESTION,
  NOTE_QUESTION,
  OUTCOME_QUESTION,
  SUPPORT_OPTIONS,
  SUPPORT_QUESTION,
  WILL_VOTE_OPTIONS,
  WILL_VOTE_QUESTION,
} from './knockQuestions'

// Matches the contract's ceiling (DoorKnockingInteraction.schema.ts) so an
// over-long note is trimmed in the field rather than 400'd on save.
const NOTE_MAX_LENGTH = 2_000

// The canvas's own `pill` helper in `renderPanel`: 34px tall, 12px of side
// padding, 14px at weight 500, fully round, `tertiary-dark` on
// `tertiary-foreground` when it is the chosen answer and a plain border when it
// is not. It had drifted to a 12px chip at weight 400 — a third of a thumb
// smaller than the design, on the one control in this product that is tapped
// one-handed at a doorstep.
const PILL_ITEM_CLASSNAME =
  'h-[34px] whitespace-nowrap rounded-full border border-components-input-border bg-transparent px-3 text-sm font-medium text-foreground data-[state=on]:border-tertiary-dark data-[state=on]:bg-tertiary-dark data-[state=on]:text-tertiary-foreground data-[state=on]:hover:bg-tertiary-dark/90'

// The canvas's `label` helper, shared by every question in the ladder and by
// the note beneath them: 12px, weight 600, uppercase with 0.03em of tracking,
// muted. Uppercase is what separates a question from the answers under it
// without a rule or a heading level.
const QUESTION_LABEL_CLASSNAME =
  'text-xs font-semibold uppercase tracking-[0.03em] text-muted-foreground'

interface RecordKnockFormProps {
  target: RoutePayloadTarget
  // Owned by WalkView so close→reopen of the form replays the SAME key:
  // dead-zone retries upsert server-side instead of duplicating the knock.
  clientKey: string
  onRecorded: (personId: string, knockStatus: DoorKnockStatus) => void
}

const ChoiceRow = <T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: Array<[T, string]>
  value: T | undefined
  onChange: (value: T | undefined) => void
}) => (
  <div>
    <span className={QUESTION_LABEL_CLASSNAME}>{label}</span>
    <ToggleGroup
      type="single"
      // Always a defined value: `''` is how this expresses "nothing chosen",
      // so the group never flips between controlled and uncontrolled.
      value={value ?? ''}
      // Tapping the chosen answer again clears it and collapses whatever it
      // opened — the correction a canvasser reaches for after a mis-tap.
      onValueChange={(next) => onChange((next || undefined) as T | undefined)}
      aria-label={label}
      // The canvas's `group` helper: 8px between pills, 8px under the label.
      className="mt-2 flex flex-wrap justify-start gap-2"
    >
      {options.map(([option, optionLabel]) => (
        <ToggleGroupItem
          key={option}
          value={option}
          className={PILL_ITEM_CLASSNAME}
        >
          {optionLabel}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  </div>
)

export default function RecordKnockForm({
  target,
  clientKey,
  onRecorded,
}: RecordKnockFormProps) {
  // Which surface's engaged branch this is. An elected official's canvasser
  // asks neither of the Win questions — a constituent has no candidate to
  // support and no election on the calendar to turn out for — so Serve gets one
  // question of its own in place of both.
  //
  // It has to have one. Every "logged" predicate in this feature is
  // `knockStatus !== 'unknown'`, and with no answer at all an engaged Serve
  // door derives to exactly that: the walk would not advance, the list would
  // never complete, and paper would reprint the door with empty boxes.
  const serveMode = useDoorKnockingServeMode()
  // Two steps, two pieces of state, because the contract's five-way outcome is
  // a flattening of the tree the canvasser walks: `answered` in step one only
  // means "keep asking", and step two is what the door actually ends as.
  const [outcome, setOutcome] = useState<DoorKnockOutcome | undefined>()
  const [engagement, setEngagement] = useState<DoorKnockOutcome | undefined>()
  const [supportAnswer, setSupportAnswer] = useState<
    SupportAnswer | undefined
  >()
  const [willVote, setWillVote] = useState<WillVoteAnswer | undefined>()
  const [followUp, setFollowUp] = useState<FollowUpAnswer | undefined>()
  const [note, setNote] = useState('')
  // Dictation is the point of the notes field in the field: nobody types a
  // paragraph one-handed on a doorstep in the rain. The shared hook already
  // reports under EVENTS.Dictation with this label — the transcript itself
  // never leaves the textarea.
  const dictation = useDictationAppend({
    analyticsLabel: 'door_knocking_note',
    value: note,
    // The textarea's maxLength only constrains typing, so a long dictation
    // appends straight past it and the same ceiling is enforced here.
    onChange: (next) => setNote(next.slice(0, NOTE_MAX_LENGTH)),
  })

  const record = useMutation({
    mutationFn: (input: {
      outcome: DoorKnockOutcome
      supportAnswer?: SupportAnswer
      willVote?: WillVoteAnswer
      followUp?: FollowUpAnswer
      note?: string
    }) =>
      clientRequest('POST /v1/door-knocking/interactions', {
        stopTargetId: target.stopTargetId,
        clientKey,
        outcome: input.outcome,
        ...(input.supportAnswer ? { supportAnswer: input.supportAnswer } : {}),
        ...(input.willVote ? { willVote: input.willVote } : {}),
        ...(input.followUp ? { followUp: input.followUp } : {}),
        ...(input.note ? { note: input.note } : {}),
      }).then((res) => res.data),
    onSuccess: (data, input) => {
      trackEvent(EVENTS.DoorKnocking.DoorLogged, {
        outcome: input.outcome,
        knockStatus: data.knockStatus,
        // Whether a note was written, never what it said — notes are about
        // named voters and don't belong in an analytics payload.
        hasNote: Boolean(input.note),
        ...(input.supportAnswer ? { supportAnswer: input.supportAnswer } : {}),
        ...(input.willVote ? { willVote: input.willVote } : {}),
        ...(input.followUp ? { followUp: input.followUp } : {}),
      })
      onRecorded(data.personId, data.knockStatus)
    },
  })

  const opened = outcome === 'answered'
  const engaged = opened && engagement === 'answered'
  // The outcome the contract gets: step two replaces step one's `answered`,
  // which was only ever the branch into it.
  const finalOutcome = opened ? engagement : outcome
  // Every branch has an ending, and the buttons appear when the canvasser
  // reaches one. An engaged Win door isn't finished until both answers are in;
  // an engaged Serve door has exactly one question and is finished by it.
  const complete = engaged
    ? serveMode
      ? Boolean(followUp)
      : Boolean(supportAnswer && willVote)
    : Boolean(finalOutcome)

  const reset = () => {
    setOutcome(undefined)
    setEngagement(undefined)
    setSupportAnswer(undefined)
    setWillVote(undefined)
    setFollowUp(undefined)
    setNote('')
    // The failure banner isn't gated on the walk, so without this a Cancel
    // after a failed save leaves it sitting over an empty form promising that
    // "your answers are still here" — which Cancel has just made untrue.
    record.reset()
  }

  const save = () => {
    if (!finalOutcome) return
    const trimmed = note.trim()
    record.mutate({
      outcome: finalOutcome,
      // The contract rejects answers on anything but `answered`, so a
      // canvasser who backed out of the engaged branch can't ship the answers
      // they had picked inside it. The surface guards are the same rule one
      // step further in: the contract also refuses support and follow-up on one
      // payload, and only the form knows which branch it just walked.
      ...(engaged && supportAnswer && !serveMode ? { supportAnswer } : {}),
      ...(engaged && willVote && !serveMode ? { willVote } : {}),
      ...(engaged && followUp && serveMode ? { followUp } : {}),
      // The note is deliberately NOT guarded the same way. Support and
      // will-vote are answers to questions this door was never asked, but a
      // note is text a person wrote, and the contract takes one on any outcome
      // (only the two answers are refined to `answered`). A canvasser who
      // types "dog in the yard" while walking the engaged branch and then
      // corrects the door to not-home meant the note either way — dropping it
      // here would delete what they wrote to enforce a tidiness the schema
      // never asked for.
      ...(trimmed ? { note: trimmed } : {}),
    })
  }

  return (
    // No card of its own. The canvas draws the ladder straight into the sticky
    // log bar with 16px between groups — the bordered box around it read as a
    // ninth card in a panel whose eight cards are all reference material, when
    // this is the only thing on the surface a canvasser acts on.
    <div className="flex flex-col gap-4">
      <ChoiceRow
        label={OUTCOME_QUESTION}
        options={ANSWER_OPTIONS}
        value={outcome}
        // Changing the outcome drops the answers underneath it but keeps the
        // note. Collapsing a row discards answers it would otherwise re-offer
        // pre-filled and unnoticed; it never discards text the canvasser
        // typed, which stays in state and comes back with the field.
        onChange={(value) => {
          setOutcome(value)
          setEngagement(undefined)
          setSupportAnswer(undefined)
          setWillVote(undefined)
          setFollowUp(undefined)
        }}
      />

      {/* Each question stays on screen once it has been answered. The walk
          expands downward rather than replacing a step with the next one: the
          answer a canvasser most wants to check before saving is the one they
          gave two taps ago. */}
      {opened && (
        <ChoiceRow
          label={ENGAGEMENT_QUESTION}
          options={ENGAGEMENT_OPTIONS}
          value={engagement}
          onChange={(value) => {
            setEngagement(value)
            if (value !== 'answered') {
              setSupportAnswer(undefined)
              setWillVote(undefined)
              setFollowUp(undefined)
            }
          }}
        />
      )}

      {/* The engaged branch is the one place the two surfaces ask different
          things, and they ask a different NUMBER of things: Win asks support
          and then turnout, Serve asks whether anything is owed afterwards.
          Everything above and below this is shared, because how a door
          answered and what the canvasser wrote down are the same questions
          whoever is knocking. */}
      {engaged && !serveMode && (
        <ChoiceRow
          label={SUPPORT_QUESTION}
          options={SUPPORT_OPTIONS}
          value={supportAnswer}
          onChange={(value) => {
            setSupportAnswer(value)
            // Clearing support collapses the will-vote row, and its answer has
            // to go with it: otherwise answering support again reopens the row
            // already filled in with a response the canvasser never gave on
            // this pass, and Save lights up on that ghost. A support answer
            // that is only *changed* keeps it, because the row never leaves
            // the screen and turnout doesn't depend on who they support.
            if (!value) setWillVote(undefined)
          }}
        />
      )}

      {engaged && serveMode && (
        <ChoiceRow
          label={FOLLOW_UP_QUESTION}
          options={FOLLOW_UP_OPTIONS}
          value={followUp}
          onChange={setFollowUp}
        />
      )}

      {engaged && supportAnswer && (
        <ChoiceRow
          label={WILL_VOTE_QUESTION}
          options={WILL_VOTE_OPTIONS}
          value={willVote}
          onChange={setWillVote}
        />
      )}

      {/* Last on every branch, and it arrives with Save: `complete` is exactly
          "this branch has nothing left to ask", so the note is always the final
          thing offered and never a thing standing between two questions. On the
          engaged branch that keeps it after will-vote, where it already sat; on
          a one-question door it puts it one tap in, which is the point — "dog in
          the yard, come back Saturday" belongs on a not-home door, and the
          prototype having no field there is the one part of its layout we
          overruled. Never required: `complete` doesn't consult it, so Save is
          live the moment the questions are done. */}
      {complete && (
        <div>
          <span className={QUESTION_LABEL_CLASSNAME}>{NOTE_QUESTION}</span>
          <div className="relative mt-2">
            <Textarea
              value={note}
              maxLength={NOTE_MAX_LENGTH}
              // The canvas's placeholder. It asks for the thing worth writing
              // down and promises the tidying-up, which is what gets a sentence
              // typed one-handed at a door; "Notes (optional)" only named the
              // field and told the canvasser they could skip it.
              placeholder="What did they say? We'll clean it up."
              rows={3}
              className="min-h-20 pr-12"
              onChange={(e) => setNote(e.target.value)}
            />
            <DictationMicButton
              dictation={dictation}
              idleLabel="Dictate note"
              recordingLabel="Stop dictation"
              disabled={record.isPending}
            />
          </div>
          <DictationFeedback dictation={dictation} />
        </div>
      )}

      {record.isError && (
        <p className="text-sm text-destructive">
          Saving failed — your answers are still here, try again.
        </p>
      )}

      {/* The canvas's `panelActions`: a full-width default Save stacked above a
          full-width outline Cancel, 8px apart. Stacked and not side by side —
          Save is the whole point of the panel and a two-up row halves the target
          it presents to a thumb; the canvas draws the same pair the same way in
          its note editor. */}
      {complete && (
        <div className="flex flex-col gap-2">
          <Button className="w-full" disabled={record.isPending} onClick={save}>
            {record.isPending ? 'Saving…' : 'Save'}
          </Button>
          {/* Clears the walkthrough without closing the door's sheet — the way
              back from three taps down the wrong branch. */}
          <Button
            className="w-full"
            variant="outline"
            disabled={record.isPending}
            onClick={reset}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}
