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
import { Button, Textarea } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'

const OUTCOME_OPTIONS: Array<[DoorKnockOutcome, string]> = [
  ['answered', 'Answered'],
  ['not_home', 'Not home'],
  ['inaccessible', 'Inaccessible'],
  ['refused_to_engage', 'Refused to engage'],
  ['not_a_voter', 'Not a voter'],
]

const SUPPORT_OPTIONS: Array<[SupportAnswer, string]> = [
  ['supporter', 'Yes'],
  ['unsure', 'Unsure'],
  ['non_supporter', 'No'],
]

const WILL_VOTE_OPTIONS: Array<[WillVoteAnswer, string]> = [
  ['yes', 'Yes'],
  ['unsure', 'Unsure'],
  ['no', 'No'],
]

interface RecordKnockFormProps {
  target: RoutePayloadTarget
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
    <div className="flex flex-wrap gap-1.5">
      {options.map(([option, optionLabel]) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          className={`rounded-full border px-3 py-1 text-xs ${
            value === option
              ? 'border-foreground bg-foreground text-background'
              : 'border-border bg-background'
          }`}
          onClick={() => onChange(option)}
        >
          {optionLabel}
        </button>
      ))}
    </div>
  </div>
)

export default function RecordKnockForm({
  target,
  onRecorded,
}: RecordKnockFormProps) {
  const [outcome, setOutcome] = useState<DoorKnockOutcome | undefined>()
  const [supportAnswer, setSupportAnswer] = useState<
    SupportAnswer | undefined
  >()
  const [willVote, setWillVote] = useState<WillVoteAnswer | undefined>()
  const [note, setNote] = useState('')
  // Minted once per form mount: retrying a failed save replays the SAME key,
  // so dead-zone retries upsert instead of duplicating the knock.
  const [clientKey] = useState(() => crypto.randomUUID())

  const record = useMutation({
    mutationFn: () => {
      if (!outcome) throw new Error('outcome required')
      const answered = outcome === 'answered'
      return clientRequest('POST /v1/door-knocking/interactions', {
        stopTargetId: target.stopTargetId,
        clientKey,
        outcome,
        ...(answered && supportAnswer ? { supportAnswer } : {}),
        ...(answered && willVote ? { willVote } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      }).then((res) => res.data)
    },
    onSuccess: (data) => {
      onRecorded(data.personId, data.knockStatus)
    },
  })

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <ChoiceRow
        label="Did they answer?"
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
            label="Do they support you?"
            options={SUPPORT_OPTIONS}
            value={supportAnswer}
            onChange={setSupportAnswer}
          />
          <ChoiceRow
            label="Will they vote?"
            options={WILL_VOTE_OPTIONS}
            value={willVote}
            onChange={setWillVote}
          />
        </>
      )}
      <Textarea
        value={note}
        maxLength={2000}
        placeholder="Notes (optional)"
        rows={2}
        onChange={(e) => setNote(e.target.value)}
      />
      {record.isError && (
        <p className="text-sm text-destructive">
          Saving failed — your answers are still here, try again.
        </p>
      )}
      <Button
        size="small"
        disabled={!outcome || record.isPending}
        onClick={() => record.mutate()}
      >
        {record.isPending ? 'Saving…' : 'Save knock'}
      </Button>
    </div>
  )
}
