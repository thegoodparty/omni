'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  DoorKnockOutcome,
  DoorKnockStatus,
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
import {
  ANSWER_OPTIONS,
  ENGAGEMENT_OPTIONS,
  ENGAGEMENT_QUESTION,
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

// Compact cousin of the CRM wizard's pill toggles (crm/shared/constants.ts)
// — same selected-state convention, sized for the walk view's dense form.
const PILL_ITEM_CLASSNAME =
  'rounded-full border border-components-input-border bg-transparent px-3 py-1 text-xs font-normal text-foreground data-[state=on]:border-tertiary-dark data-[state=on]:bg-tertiary-dark data-[state=on]:text-tertiary-foreground data-[state=on]:hover:bg-tertiary-dark/90'

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
  <div className="flex flex-col gap-1">
    <span className="text-xs font-medium text-muted-foreground">{label}</span>
    <ToggleGroup
      type="single"
      // Always a defined value: `''` is how this expresses "nothing chosen",
      // so the group never flips between controlled and uncontrolled.
      value={value ?? ''}
      // Tapping the chosen answer again clears it and collapses whatever it
      // opened — the correction a canvasser reaches for after a mis-tap.
      onValueChange={(next) => onChange((next || undefined) as T | undefined)}
      aria-label={label}
      className="flex flex-wrap justify-start gap-1.5"
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
  // Two steps, two pieces of state, because the contract's five-way outcome is
  // a flattening of the tree the canvasser walks: `answered` in step one only
  // means "keep asking", and step two is what the door actually ends as.
  const [outcome, setOutcome] = useState<DoorKnockOutcome | undefined>()
  const [engagement, setEngagement] = useState<DoorKnockOutcome | undefined>()
  const [supportAnswer, setSupportAnswer] = useState<
    SupportAnswer | undefined
  >()
  const [willVote, setWillVote] = useState<WillVoteAnswer | undefined>()
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
      note?: string
    }) =>
      clientRequest('POST /v1/door-knocking/interactions', {
        stopTargetId: target.stopTargetId,
        clientKey,
        outcome: input.outcome,
        ...(input.supportAnswer ? { supportAnswer: input.supportAnswer } : {}),
        ...(input.willVote ? { willVote: input.willVote } : {}),
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
  // reaches one. An engaged door isn't finished until both answers are in.
  const complete = engaged
    ? Boolean(supportAnswer && willVote)
    : Boolean(finalOutcome)

  const reset = () => {
    setOutcome(undefined)
    setEngagement(undefined)
    setSupportAnswer(undefined)
    setWillVote(undefined)
    setNote('')
  }

  const save = () => {
    if (!finalOutcome) return
    const trimmed = note.trim()
    record.mutate({
      outcome: finalOutcome,
      // The contract rejects answers on anything but `answered`, so a
      // canvasser who backed out of the engaged branch can't ship the answers
      // they had picked inside it.
      ...(engaged && supportAnswer ? { supportAnswer } : {}),
      ...(engaged && willVote ? { willVote } : {}),
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
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
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
            }
          }}
        />
      )}

      {engaged && (
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
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            {NOTE_QUESTION}
          </span>
          <div className="relative">
            <Textarea
              value={note}
              maxLength={NOTE_MAX_LENGTH}
              placeholder="Notes (optional)"
              rows={2}
              className="pr-12"
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

      {complete && (
        <div className="flex flex-col gap-2">
          <Button size="small" disabled={record.isPending} onClick={save}>
            {record.isPending ? 'Saving…' : 'Save'}
          </Button>
          {/* Clears the walkthrough without closing the door's sheet — the way
              back from three taps down the wrong branch. */}
          <Button
            size="small"
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
