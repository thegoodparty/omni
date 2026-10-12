'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ConfirmedConstituentFeedbackIssue,
  DoorKnockOutcome,
  DoorKnockStatus,
  FollowUpAnswer,
  RecordConstituentFeedbackResponse,
  RecordDoorKnockInteraction,
  RoutePayloadTarget,
  SupportAnswer,
  WillVoteAnswer,
} from '@goodparty_org/contracts'
import {
  Button,
  CircleCheckIcon,
  Textarea,
  ToggleGroup,
  ToggleGroupItem,
} from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useSnackbar } from 'helpers/useSnackbar'
import {
  outreachEventProps,
  outreachProduct,
} from 'app/dashboard/outreach/util/outreachAnalytics'
import { useDictationAppend } from 'app/dashboard/shared/dictation/useDictationAppend'
import {
  OFFLINE_MEMO_COPY,
  isNetworkError,
  useOfflineMemo,
} from 'app/dashboard/shared/dictation/useOfflineMemo'
import type { QueuedMemo } from 'app/dashboard/shared/dictation/offlineMemoQueue'
import { DictationMicButton } from 'app/dashboard/shared/dictation/DictationMicButton'
import { DictationFeedback } from 'app/dashboard/briefings/shared/DictationFeedback'
import { useIssueCaptureFlag } from 'app/shared/experiments/issueCaptureFlag'
import type { UnsavedDrafts } from 'app/dashboard/shared/useUnsavedDrafts'
import { REPORT_QUERY_KEY_PREFIX } from 'app/dashboard/issue-capture/[outreachId]/queries'
import { useDoorKnockingServeMode } from './doorKnockingSurface'
import IssueCaptureConfirmCard, {
  wasCorrected,
} from './IssueCaptureConfirmCard'
import {
  ANSWER_OPTIONS,
  engagementOptions,
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

// Mode-keyed rather than renamed, per `docs/product-vocabulary.md`. A door
// where capture cannot fire gets the plain note prompt on either product,
// since promising an extraction there would be a claim the product does not
// keep. A door where it can asks for the memo in that product's own words.
const NOTE_PLACEHOLDER = {
  note: "What did they say? We'll clean it up.",
  capture: {
    win: 'What did they tell you?',
    serve:
      'Record the issues and positions this person cares most about. ' +
      "Say it out loud, we'll clean it up",
  },
}

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

// What gp-api's `deriveKnockStatus` makes of a knock, for one saved with no
// signal: the walk moves on as it would online, and the server's own answer
// replaces this when the knock lands and the route is read again.
const offlineKnockStatus = (
  knock: RecordDoorKnockInteraction,
): DoorKnockStatus => {
  if (knock.followUp === 'yes') return 'needs_follow_up'
  if (knock.followUp === 'no') return 'engaged'
  if (knock.supportAnswer === 'supporter') return 'supporter'
  if (knock.supportAnswer === 'non_supporter') return 'non_supporter'
  if (knock.outcome === 'refused_to_engage') return 'refused'
  if (knock.outcome === 'inaccessible') return 'inaccessible'
  if (knock.outcome === 'not_a_voter') return 'not_a_voter'
  if (knock.outcome === 'not_home') return 'not_home'
  return 'unknown'
}

interface KnockInput {
  outcome: DoorKnockOutcome
  supportAnswer?: SupportAnswer
  willVote?: WillVoteAnswer
  followUp?: FollowUpAnswer
  note?: string
  engaged: boolean
  captureMethod: 'dictation' | 'typed'
  // A memo the phone recorded with no signal to dictate over.
  recording: Blob | null
}

// What a door's form keeps when it unmounts unsaved. Not a recording in
// progress, and not a confirm card: the knock behind a confirm card is saved.
export interface KnockDraft {
  outcome?: DoorKnockOutcome
  engagement?: DoorKnockOutcome
  supportAnswer?: SupportAnswer
  willVote?: WillVoteAnswer
  followUp?: FollowUpAnswer
  note: string
  spoken: boolean
}

interface RecordKnockFormProps {
  target: RoutePayloadTarget
  // The turf this door belongs to — the parent list every logged door rolls
  // up to on the outreach side. See docs/features/voter-outreach-analytics.md.
  turfId: number
  // Owned by WalkView so close→reopen of the form replays the SAME key:
  // dead-zone retries upsert server-side instead of duplicating the knock.
  clientKey: string
  onRecorded: (personId: string, knockStatus: DoorKnockStatus) => void
  // Owned by the walk, keyed by stop target: the form is keyed the same way,
  // so tapping a housemate and back remounts it, and this is what brings the
  // answers back.
  drafts?: UnsavedDrafts<KnockDraft>
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
  turfId,
  clientKey,
  onRecorded,
  drafts,
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
  // Issue capture runs on both products, behind one flag.
  // `trackExposure` stays default: this form is the treatment surface.
  const { enabled: captureEnabled } = useIssueCaptureFlag()
  const product = outreachProduct(serveMode)
  // Two steps, two pieces of state, because the contract's five-way outcome is
  // a flattening of the tree the canvasser walks: `answered` in step one only
  // means "keep asking", and step two is what the door actually ends as.
  const draftKey = String(target.stopTargetId)
  const [stashed] = useState(() => drafts?.get(draftKey))
  const [outcome, setOutcome] = useState<DoorKnockOutcome | undefined>(
    stashed?.outcome,
  )
  const [engagement, setEngagement] = useState<DoorKnockOutcome | undefined>(
    stashed?.engagement,
  )
  const [supportAnswer, setSupportAnswer] = useState<SupportAnswer | undefined>(
    stashed?.supportAnswer,
  )
  const [willVote, setWillVote] = useState<WillVoteAnswer | undefined>(
    stashed?.willVote,
  )
  const [followUp, setFollowUp] = useState<FollowUpAnswer | undefined>(
    stashed?.followUp,
  )
  const [note, setNote] = useState(stashed?.note ?? '')
  // Dictation is the point of the notes field in the field: nobody types a
  // paragraph one-handed on a doorstep in the rain. The shared hook already
  // reports under EVENTS.Dictation with this label — the transcript itself
  // never leaves the textarea.
  // Whether any of the note arrived by voice. Only the dictation hook's own
  // callback can say so, and it is worth recording: capture method is the
  // metric that tells us whether the ten-second spoken memo is something
  // canvassers actually do or something we imagined they would.
  const [spoken, setSpoken] = useState(stashed?.spoken ?? false)
  // What the form holds unsaved, read on unmount. `saved` is set by a save
  // that landed and stays set until Cancel, so a door left after its knock
  // saved stashes nothing, even when a transcript lands after Save.
  const unsavedRef = useRef<{ saved: boolean; draft: KnockDraft | null }>({
    saved: false,
    draft: null,
  })
  useEffect(() => {
    unsavedRef.current = {
      saved: unsavedRef.current.saved,
      draft:
        outcome !== undefined || note !== ''
          ? {
              outcome,
              engagement,
              supportAnswer,
              willVote,
              followUp,
              note,
              spoken,
            }
          : null,
    }
  }, [outcome, engagement, supportAnswer, willVote, followUp, note, spoken])
  useEffect(() => {
    const unsaved = unsavedRef
    return () => {
      const { saved, draft } = unsaved.current
      if (saved || draft === null) drafts?.clear(draftKey)
      else drafts?.set(draftKey, draft)
    }
  }, [drafts, draftKey])
  const markSaved = () => {
    unsavedRef.current = { saved: true, draft: null }
    drafts?.clear(draftKey)
  }
  const dictation = useDictationAppend({
    analyticsLabel: 'door_knocking_note',
    value: note,
    // The textarea's maxLength only constrains typing, so a long dictation
    // appends straight past it and the same ceiling is enforced here.
    onChange: (next) => {
      setNote(next.slice(0, NOTE_MAX_LENGTH))
      setSpoken(true)
    },
  })
  const opened = outcome === 'answered'
  const engaged = opened && engagement === 'answered'
  // The render-time twin of the condition `record`'s onSuccess snapshots: it
  // decides what the field ASKS for, where the snapshot decides what was
  // asked for. Same facts, so the promise and the behavior agree.
  const capturesIssues = captureEnabled && engaged
  // Doors are where signal drops. With none, the mic records on the phone,
  // and Save holds the knock and its memo there until there is. Only where
  // a memo can be captured: elsewhere the mic is the ordinary dictation mic,
  // and the flag stays the way to turn the whole path off.
  const offline = useOfflineMemo({ dictation, enabled: capturesIssues })
  // The door the queue files this knock and its memo under, so saving it
  // again replaces them rather than queueing a second pair.
  const doorKey = String(target.stopTargetId)
  const { successSnackbar } = useSnackbar()
  const [holdFailed, setHoldFailed] = useState(false)
  // The turf's "What we heard" counts read the report once and stay fresh
  // for minutes, so each write that changes them re-reads it.
  const queryClient = useQueryClient()
  const refreshReport = () =>
    void queryClient.invalidateQueries({ queryKey: REPORT_QUERY_KEY_PREFIX })

  // Held between the knock save and the confirm step. A ref rather than state
  // because `advance` is called from mutation callbacks in the same tick the
  // knock's own success handler sets it, and a render has not happened yet.
  const recordedRef = useRef<{
    personId: string
    knockStatus: DoorKnockStatus
  } | null>(null)
  const [captured, setCaptured] = useState<{
    id: string
    proposed: RecordConstituentFeedbackResponse['extraction']
  } | null>(null)

  // The one place the walk moves on, so confirmed, skipped and failed all
  // leave the form in the same state.
  const advance = () => {
    const done = recordedRef.current
    if (done === null) return
    onRecorded(done.personId, done.knockStatus)
  }

  const trackDoorLogged = (input: KnockInput, knockStatus: DoorKnockStatus) =>
    trackEvent(EVENTS.DoorKnocking.DoorLogged, {
      // The channel/fanout pair every outreach event carries, so one door
      // rolls into "voters reached" without a chart naming door knocking.
      ...outreachEventProps({
        channel: 'doorKnocking',
        isServe: serveMode,
        listId: turfId,
      }),
      outcome: input.outcome,
      knockStatus,
      // Whether a note was written, never what it said — notes are about
      // named voters and don't belong in an analytics payload.
      hasNote: Boolean(input.note),
      ...(input.supportAnswer ? { supportAnswer: input.supportAnswer } : {}),
      ...(input.willVote ? { willVote: input.willVote } : {}),
      ...(input.followUp ? { followUp: input.followUp } : {}),
    })

  const knockRequest = (input: KnockInput): RecordDoorKnockInteraction => ({
    stopTargetId: target.stopTargetId,
    clientKey,
    outcome: input.outcome,
    ...(input.supportAnswer ? { supportAnswer: input.supportAnswer } : {}),
    ...(input.willVote ? { willVote: input.willVote } : {}),
    ...(input.followUp ? { followUp: input.followUp } : {}),
    ...(input.note ? { note: input.note } : {}),
  })

  // Only a conversation gets extracted, and only one with something said.
  const memoFor = (input: KnockInput): QueuedMemo | null =>
    captureEnabled && input.engaged && (input.note || input.recording)
      ? {
          reference: {
            channel: 'door_knock',
            knockClientKey: clientKey,
            stopTargetId: target.stopTargetId,
            clientKey,
          },
          ...(input.note
            ? {
                text: {
                  transcript: input.note,
                  captureMethod: input.captureMethod,
                },
              }
            : {}),
          analytics: { channel: 'doorKnocking', product },
        }
      : null

  // The phone keeps what it cannot send yet, and the walk moves on. There is
  // no confirm card: nothing is extracted until the memo reaches the server,
  // so the issues wait in "Notes to review".
  const hold = async (
    input: KnockInput,
    interaction: RecordDoorKnockInteraction | null,
    done: { personId: string; knockStatus: DoorKnockStatus },
  ): Promise<boolean> => {
    try {
      await offline.hold({
        key: doorKey,
        interaction:
          interaction === null ? null : { kind: 'knock', payload: interaction },
        memo: memoFor(input),
      })
    } catch {
      // A knock that already saved walks on; one that did not stays put
      // with its answers, like any failed save.
      if (interaction === null) onRecorded(done.personId, done.knockStatus)
      else setHoldFailed(true)
      return false
    }
    markSaved()
    // With the knock saved, only the recording waits, and it goes now.
    successSnackbar(
      interaction === null
        ? OFFLINE_MEMO_COPY.sending
        : OFFLINE_MEMO_COPY.saved,
    )
    onRecorded(done.personId, done.knockStatus)
    return true
  }

  // The door is logged on the phone, so it counts as logged now; the knock
  // itself reaches the server when the queue drains.
  const saveOffline = async (input: KnockInput) => {
    const knock = knockRequest(input)
    const knockStatus = offlineKnockStatus(knock)
    if (await hold(input, knock, { personId: target.personId, knockStatus })) {
      trackDoorLogged(input, knockStatus)
    }
  }

  // `engaged` and `captureMethod` ride the variables for the reason every
  // other field here already does: react-query refreshes a mutation's
  // callbacks each render, so `onSuccess` runs against the latest closure
  // rather than the one that fired it, and the engagement pills stay live
  // while the request is out. A canvasser who re-taps one mid-save would
  // otherwise have the memo dropped on a door that saved as engaged.
  const record = useMutation({
    mutationFn: (input: KnockInput) =>
      clientRequest(
        'POST /v1/door-knocking/interactions',
        knockRequest(input),
      ).then((res) => res.data),
    onSuccess: async (data, input) => {
      markSaved()
      trackDoorLogged(input, data.knockStatus)
      refreshReport()
      // This save supersedes whatever the phone still held for the door, so
      // a later drain cannot send an older knock over it.
      // Only where capture is on: with the flag off the form is exactly what
      // it was, and has queued nothing to supersede.
      if (captureEnabled) await offline.forget(doorKey).catch(() => undefined)
      // `engaged` and not merely `complete`: the note field is deliberately
      // offered on every branch, including a not-home door, so "dog in the
      // yard, come back Saturday" is a note the knock should keep but never a
      // person's position on an issue. Only a conversation gets extracted.
      const memo = memoFor(input)
      if (memo === null) {
        onRecorded(data.personId, data.knockStatus)
        return
      }
      // A recording made earlier with no signal, and no words to send
      // instead: it goes the offline way, after the knock it belongs to.
      // Words win over a recording, as they do in the queue.
      if (memo.text === undefined) {
        void hold(input, null, data)
        return
      }
      recordedRef.current = {
        personId: data.personId,
        knockStatus: data.knockStatus,
      }
      capture.mutate(memo.text)
    },
    // A request that got no answer at all is a dead zone the browser has not
    // noticed: the knock is held like any offline one, so the canvasser is
    // never kept at the door by "Saving failed".
    onError: (error, input) => {
      if (captureEnabled && isNetworkError(error)) void saveOffline(input)
    },
  })

  // The memo is a second write on top of a knock that has already saved, and
  // it reuses the knock's clientKey: one memo per knock, and a dead-zone retry
  // upserts the same row rather than forking a duplicate.
  // `captureMethod` rides the variables rather than being read off `spoken`
  // twice: the request goes on mutate and the event on settle, a round trip
  // apart, so a reset in between would have them disagree about one memo.
  const capture = useMutation({
    mutationFn: (input: {
      transcript: string
      captureMethod: 'dictation' | 'typed'
    }) =>
      clientRequest('POST /v1/constituent-feedback', {
        channel: 'door_knock',
        knockClientKey: clientKey,
        stopTargetId: target.stopTargetId,
        clientKey,
        transcript: input.transcript,
        captureMethod: input.captureMethod,
      }).then((res) => res.data),
    onSuccess: (data, input) => {
      trackEvent(EVENTS.IssueCapture.MemoRecorded, {
        channel: 'doorKnocking',
        captureMethod: input.captureMethod,
        extractionStatus: data.extractionStatus,
        product,
      })
      setCaptured({ id: data.id, proposed: data.extraction })
      refreshReport()
    },
    // Holding a canvasser at a door whose knock already saved, because a
    // second request failed, is worse than losing the memo. Advance.
    onError: () => advance(),
  })

  const confirm = useMutation({
    mutationFn: (issues: ConfirmedConstituentFeedbackIssue[]) =>
      clientRequest('PATCH /v1/constituent-feedback/:id/confirm', {
        id: captured?.id ?? '',
        issues,
      }).then((res) => res.data),
    onSuccess: (_data, issues) => {
      trackEvent(EVENTS.IssueCapture.MemoConfirmed, {
        channel: 'doorKnocking',
        corrected: wasCorrected(captured?.proposed ?? null, issues),
        issueCount: issues.length,
        product,
      })
      refreshReport()
      advance()
    },
    // A failed confirm leaves the memo saved and unconfirmed, which reporting
    // can already tell apart. Holding the canvasser is the worse outcome.
    onError: () => advance(),
  })

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
    setSpoken(false)
    // The failure banner isn't gated on the walk, so without this a Cancel
    // after a failed save leaves it sitting over an empty form promising that
    // "your answers are still here" — which Cancel has just made untrue.
    record.reset()
    setHoldFailed(false)
    offline.discard()
    unsavedRef.current = { saved: false, draft: null }
    drafts?.clear(draftKey)
  }

  const save = () => {
    if (!finalOutcome) return
    const trimmed = note.trim()
    const input: KnockInput = {
      outcome: finalOutcome,
      engaged,
      captureMethod: spoken ? 'dictation' : 'typed',
      recording: offline.audio,
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
    }
    setHoldFailed(false)
    // No signal, or a socket that would not open for this door: a knock
    // sent now would only fail, so it waits on the phone with its memo.
    if (captureEnabled && (!navigator.onLine || offline.fellBack)) {
      void saveOffline(input)
      return
    }
    record.mutate(input)
  }

  // The knock is already saved by the time this renders, so the ladder is
  // replaced rather than added to: every question on it has been answered and
  // leaving them on screen would invite a correction that no longer has
  // anywhere to go.
  if (captured !== null) {
    return (
      <IssueCaptureConfirmCard
        proposed={captured.proposed}
        saving={confirm.isPending}
        isServe={serveMode}
        onConfirm={(issues) => confirm.mutate(issues)}
        onSkip={() => {
          trackEvent(EVENTS.IssueCapture.MemoSkipped, {
            channel: 'doorKnocking',
            product,
          })
          advance()
        }}
      />
    )
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
          options={engagementOptions(serveMode)}
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
              placeholder={
                capturesIssues
                  ? NOTE_PLACEHOLDER.capture[product]
                  : NOTE_PLACEHOLDER.note
              }
              rows={3}
              className="min-h-20 pr-12"
              onChange={(e) => setNote(e.target.value)}
            />
            <DictationMicButton
              dictation={offline.mic}
              idleLabel="Dictate note"
              recordingLabel="Stop dictation"
              disabled={record.isPending}
            />
          </div>
          {offline.audio !== null && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <CircleCheckIcon
                size={14}
                aria-hidden="true"
                className="shrink-0 text-success-dark"
              />
              {OFFLINE_MEMO_COPY.recorded}
            </p>
          )}
          <DictationFeedback dictation={offline.mic} />
        </div>
      )}

      {/* A network error with capture on is being held on the phone, not a
          failed save; `holdFailed` says so if holding fails too. */}
      {((record.isError && !(captureEnabled && isNetworkError(record.error))) ||
        holdFailed) && (
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
