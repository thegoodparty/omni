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
import { useDictationAppend } from 'app/dashboard/briefings/shared/useDictationAppend'
import { DictationMicButton } from 'app/dashboard/briefings/shared/DictationMicButton'
import { DictationFeedback } from 'app/dashboard/briefings/shared/DictationFeedback'
import {
  OUTCOME_OPTIONS,
  OUTCOME_QUESTION,
  QUICK_QUESTION,
  QUICK_RESULTS,
  QuickResult,
  SUPPORT_OPTIONS,
  SUPPORT_QUESTION,
  WILL_VOTE_OPTIONS,
  WILL_VOTE_QUESTION,
} from './knockQuestions'

// Compact cousin of the CRM wizard's pill toggles (crm/shared/constants.ts)
// — same selected-state convention, sized for the walk view's dense form.
// Matches the contract's ceiling (DoorKnockingInteraction.schema.ts) so an
// over-long note is trimmed in the field rather than 400'd on save.
const NOTE_MAX_LENGTH = 2_000

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
  onChange: (value: T) => void
}) => (
  <div className="flex flex-col gap-1">
    <span className="text-xs font-medium text-muted-foreground">{label}</span>
    <ToggleGroup
      type="single"
      value={value ?? ''}
      onValueChange={(next) => next && onChange(next as T)}
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
  // Starts on the fast path; the canvasser opts into the long form.
  const [detail, setDetail] = useState(false)
  const [outcome, setOutcome] = useState<DoorKnockOutcome | undefined>()
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
    // The textarea's maxLength only constrains typing; a long dictation
    // appends straight past it, so the same ceiling is enforced here.
    onChange: (next) => setNote(next.slice(0, NOTE_MAX_LENGTH)),
  })

  // The payload travels as an argument rather than being read off state at
  // send time: the quick path fires from inside a chip's own handler, one
  // render before its state would settle.
  const record = useMutation({
    mutationFn: (input: {
      outcome: DoorKnockOutcome
      supportAnswer?: SupportAnswer
      willVote?: WillVoteAnswer
      note?: string
      // Not sent to the server — carried through so onSuccess can report
      // which path the canvasser actually used.
      logMode: 'quick' | 'detail'
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
        // The brief's two-tap claim is only worth anything if it's the path
        // people take, so the split is measured rather than assumed.
        logMode: input.logMode,
        ...(input.supportAnswer ? { supportAnswer: input.supportAnswer } : {}),
        ...(input.willVote ? { willVote: input.willVote } : {}),
      })
      onRecorded(data.personId, data.knockStatus)
    },
  })

  const saveQuick = (result: QuickResult) =>
    record.mutate({
      outcome: result.outcome,
      ...(result.supportAnswer ? { supportAnswer: result.supportAnswer } : {}),
      logMode: 'quick',
    })

  const saveDetail = () => {
    if (!outcome) return
    const answered = outcome === 'answered'
    record.mutate({
      outcome,
      ...(answered && supportAnswer ? { supportAnswer } : {}),
      ...(answered && willVote ? { willVote } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      logMode: 'detail',
    })
  }

  // The two paths are exclusive on purpose. Showing the flat chips and the
  // cascade together would offer two ways to answer the same question, and a
  // chip that saves instantly sitting beside fields that don't is the kind of
  // ambiguity that gets resolved by tapping the wrong thing.
  if (!detail) {
    return (
      <div className="flex flex-col gap-3 rounded-md border border-border p-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">
            {QUICK_QUESTION}
          </span>
          <div className="flex flex-wrap justify-start gap-1.5">
            {QUICK_RESULTS.map((result) => (
              <button
                key={result.id}
                type="button"
                disabled={record.isPending}
                className={`${PILL_ITEM_CLASSNAME} disabled:opacity-50`}
                onClick={() => saveQuick(result)}
              >
                {result.label}
              </button>
            ))}
          </div>
        </div>
        {record.isPending && (
          <p className="text-sm text-muted-foreground">Saving…</p>
        )}
        {record.isError && (
          <p className="text-sm text-destructive">
            Saving failed — try again, or add detail.
          </p>
        )}
        <button
          type="button"
          className="self-start text-xs font-medium underline underline-offset-2"
          onClick={() => setDetail(true)}
        >
          Add a note or more detail
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <ChoiceRow
        label={OUTCOME_QUESTION}
        options={OUTCOME_OPTIONS}
        value={outcome}
        onChange={(value) => {
          setOutcome(value)
          if (value !== 'answered') {
            setSupportAnswer(undefined)
            setWillVote(undefined)
          }
        }}
      />
      {outcome === 'answered' && (
        <>
          <ChoiceRow
            label={SUPPORT_QUESTION}
            options={SUPPORT_OPTIONS}
            value={supportAnswer}
            onChange={setSupportAnswer}
          />
          <ChoiceRow
            label={WILL_VOTE_QUESTION}
            options={WILL_VOTE_OPTIONS}
            value={willVote}
            onChange={setWillVote}
          />
        </>
      )}
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
      {record.isError && (
        <p className="text-sm text-destructive">
          Saving failed — your answers are still here, try again.
        </p>
      )}
      <Button
        size="small"
        disabled={!outcome || record.isPending}
        onClick={saveDetail}
      >
        {record.isPending ? 'Saving…' : 'Save knock'}
      </Button>
    </div>
  )
}
