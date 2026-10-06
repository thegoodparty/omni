'use client'

import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { REPORT_QUERY_KEY_PREFIX } from 'app/dashboard/issue-capture/[outreachId]/queries'
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
import IssueCaptureConfirmCard, {
  wasCorrected,
} from 'app/dashboard/door-knocking/native/IssueCaptureConfirmCard'
import type {
  PhoneBankingCallResult,
  PhoneBankingInteraction,
  ConfirmedConstituentFeedbackIssue,
  RecordConstituentFeedbackResponse,
} from '@goodparty_org/contracts'
import { CONSTITUENT_FEEDBACK_TRANSCRIPT_MAX_LENGTH } from '@goodparty_org/contracts'
import {
  Button,
  FilterPill,
  FilterPillGroup,
  IconButton,
  PencilIcon,
  Textarea,
  cn,
} from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import {
  outreachEventProps,
  outreachProduct,
} from '../../util/outreachAnalytics'
import {
  OUTCOME_DOT_CLASS,
  OUTCOME_LABEL,
  OUTCOME_ORDER,
  FOLLOW_UP_ANSWER_LABEL,
  SUPPORT_ANSWER_LABEL,
  WILL_VOTE_ANSWER_LABEL,
  buildRecordCallRequest,
  draftFromInteraction,
  draftWithEngagement,
  draftWithFollowUp,
  draftWithOutcome,
  draftWithSupportAnswer,
  draftWithWillVote,
  engagementStatusFor,
  isDraftComplete,
  type PhoneBankingOutcomeDraft,
} from './phoneBankingOutcome.util'

// Win asks its one question in the placeholder, so its label only names the
// field; Serve's label asks and its placeholder says what to record.
const MEMO_LABEL = {
  win: 'Their note',
  serve: 'What did they say?',
}

const MEMO_PLACEHOLDER = {
  win: 'What did they tell you?',
  serve:
    'Record the issues and positions this person cares most about. ' +
    "Say it out loud, we'll clean it up",
}

// Everything `onSuccess` needs, frozen when Save is pressed. react-query
// refreshes a mutation's callbacks on every render, so `onSuccess` runs
// against the LATEST render's closure rather than the one that fired it — and
// nothing disables the pills or the memo box while the request is in flight.
// A caller who edits either mid-save would otherwise have the memo dropped
// (an engaged call edited to refused skips capture) or the wrong draft
// reported to analytics.
interface SaveInput {
  markHouseholdDone: boolean
  draft: PhoneBankingOutcomeDraft
  capturesIssues: boolean
  transcript: string
  captureMethod: 'dictation' | 'typed'
  // A memo the phone recorded with no signal to dictate over.
  recording: Blob | null
}

interface CaptureInput {
  transcript: string
  captureMethod: 'dictation' | 'typed'
}

interface PhoneBankingOutcomeFormProps {
  listId: number
  entryId: number
  entrySeq: number
  personId: string
  interaction: PhoneBankingInteraction | null
  householdHasOthersUnlogged: boolean
  // Serve asks one question of an engaged call where Win asks two — see
  // `isDraftComplete`. Threaded from the caller page's `list.isServe` rather
  // than re-derived, so one loaded list cannot answer it two ways.
  isServe: boolean
  onSaved: (results: PhoneBankingCallResult[]) => void
}

// Keyed by personId from the panel, so switching the active tab remounts
// this component entirely — the cleanest way to make "tabs switch which
// record is shown" hold, matching door-knocking's RecordKnockForm
// (`key={target.stopTargetId}`) rather than reconciling draft state across
// a person switch by hand.
export default function PhoneBankingOutcomeForm({
  listId,
  entryId,
  entrySeq,
  personId,
  interaction,
  householdHasOthersUnlogged,
  isServe,
  onSaved,
}: PhoneBankingOutcomeFormProps): React.JSX.Element {
  const [draft, setDraft] = useState<PhoneBankingOutcomeDraft>(() =>
    draftFromInteraction(interaction, isServe),
  )
  // Summary state once something is saved; the cascade form reopens only on
  // Edit — mirrors the canvas's sticky log-call bar.
  const [isEditing, setIsEditing] = useState(!interaction)

  // Issue capture. Behind its flag, and only once the call is
  // answered — there is nothing to summarize about a voicemail.
  const { enabled: captureEnabled } = useIssueCaptureFlag()
  const product = outreachProduct(isServe)
  const [memo, setMemo] = useState('')
  const [spoken, setSpoken] = useState(false)
  const [captured, setCaptured] = useState<{
    id: string
    proposed: RecordConstituentFeedbackResponse['extraction']
  } | null>(null)
  // A failed capture is the one failure on this surface that loses DATA: the
  // call's own payload carries no memo, so unlike the door — where the note
  // rides the knock and only the extraction is lost — nothing else holds
  // these words. Keeping them here is what makes the retry below possible.
  const [failedMemo, setFailedMemo] = useState<CaptureInput | null>(null)
  // Replay idempotency for THIS mount's retries, which is all a client-minted
  // key can be: the panel keys this component on personId, so a tab switch
  // mints a fresh one. Re-recording the same call across a remount is made
  // safe by gp-api resolving the row from the interaction rather than from
  // this key — see `capture()` in constituentFeedback.service.ts.
  const memoKeyRef = useRef(crypto.randomUUID())
  const dictation = useDictationAppend({
    analyticsLabel: 'phone_banking_memo',
    value: memo,
    onChange: (next) => {
      setMemo(next.slice(0, CONSTITUENT_FEEDBACK_TRANSCRIPT_MAX_LENGTH))
      setSpoken(true)
    },
  })
  // `answered` is only the branch INTO the engagement question, and two of
  // its three answers are non-conversations: a refused or hung-up call is a
  // person-attributed outcome, not something the person said. Capturing
  // there would file a memo about a conversation that did not happen.
  const capturesIssues =
    captureEnabled &&
    draft.outcome === 'answered' &&
    draft.engagement === 'engaged'
  // With no signal the mic records on the phone, and Save holds the call and
  // its memo there until there is, call first. Only where a memo can be
  // captured: elsewhere the mic is the ordinary dictation mic.
  const offline = useOfflineMemo({ dictation, enabled: capturesIssues })
  // The call the queue files this save and its memo under, so saving it
  // again replaces them rather than queueing a second pair.
  const callKey = `${entryId}:${personId}`
  // Shown where the confirm card would be: nothing is extracted until the
  // memo reaches the server, so the issues wait in "Notes to review".
  // `saved` when nothing reached the server, `sending` when the call did and
  // only the recording waits.
  const [queued, setQueued] = useState<keyof typeof OFFLINE_MEMO_COPY | null>(
    null,
  )
  const [holdFailed, setHoldFailed] = useState(false)
  // The caller page's "What we heard" counts read the report once, so each
  // write that changes them re-reads it.
  const queryClient = useQueryClient()
  const refreshReport = () =>
    void queryClient.invalidateQueries({ queryKey: REPORT_QUERY_KEY_PREFIX })

  // `captureMethod` rides the mutation's variables rather than being read off
  // `spoken` twice. The two reads happen a round trip apart — the request on
  // mutate, the event on settle — so once `spoken` is reset after a save they
  // would disagree about the same memo, and the event is the half we would
  // believe later.
  const capture = useMutation({
    mutationFn: (input: CaptureInput) =>
      clientRequest('POST /v1/constituent-feedback', {
        channel: 'phone_bank',
        entryId,
        personId,
        clientKey: memoKeyRef.current,
        transcript: input.transcript,
        captureMethod: input.captureMethod,
      }).then((res) => res.data),
    onSuccess: (data, input) => {
      trackEvent(EVENTS.IssueCapture.MemoRecorded, {
        channel: 'phoneBanking',
        captureMethod: input.captureMethod,
        extractionStatus: data.extractionStatus,
        product,
      })
      setCaptured({ id: data.id, proposed: data.extraction })
      setFailedMemo(null)
      refreshReport()
    },
    onError: (_error, input) => setFailedMemo(input),
  })

  const confirmCapture = useMutation({
    mutationFn: (issues: ConfirmedConstituentFeedbackIssue[]) =>
      clientRequest('PATCH /v1/constituent-feedback/:id/confirm', {
        id: captured?.id ?? '',
        issues,
      }).then((res) => res.data),
    onSuccess: (_data, issues) => {
      trackEvent(EVENTS.IssueCapture.MemoConfirmed, {
        channel: 'phoneBanking',
        corrected: wasCorrected(captured?.proposed ?? null, issues),
        issueCount: issues.length,
        product,
      })
    },
    // Dismiss either way: a failed confirm leaves the memo saved and
    // unconfirmed, which reporting already tells apart.
    onSettled: () => {
      setCaptured(null)
      refreshReport()
    },
  })

  const logCallAnalytics = (savedDraft: PhoneBankingOutcomeDraft): void => {
    if (!savedDraft.outcome) return
    // What the API stored, not the raw pill: engage = Refused/Hung up
    // persists as that outcome on this person.
    const savedOutcome =
      savedDraft.outcome === 'answered' &&
      (savedDraft.engagement === 'refused' ||
        savedDraft.engagement === 'hung_up')
        ? savedDraft.engagement
        : savedDraft.outcome
    trackEvent(EVENTS.Outreach.PhoneBanking.CallLogged, {
      // The channel/fanout pair every outreach event carries, so one call
      // rolls into "voters reached" without a chart naming phone banking.
      // `listId` is the parent call list, already on this payload.
      ...outreachEventProps({
        channel: 'phoneBanking',
        isServe: isServe,
        listId,
      }),
      contactId: personId,
      listRank: entrySeq,
      answerStatus: savedOutcome,
      engagementStatus: engagementStatusFor(savedOutcome),
      supportStatus: savedDraft.supportAnswer,
      voterStatus: savedDraft.willVote,
    })
  }

  const memoFor = (input: SaveInput): QueuedMemo | null =>
    input.capturesIssues && (input.transcript || input.recording)
      ? {
          reference: {
            channel: 'phone_bank',
            entryId,
            personId,
            clientKey: memoKeyRef.current,
          },
          ...(input.transcript
            ? {
                text: {
                  transcript: input.transcript,
                  captureMethod: input.captureMethod,
                },
              }
            : {}),
          analytics: { channel: 'phoneBanking', product },
        }
      : null

  // `withCall` is false when the call itself already saved online and only
  // the recording has to wait.
  const hold = async (input: SaveInput, withCall: boolean) => {
    const request = buildRecordCallRequest(
      entryId,
      input.draft,
      personId,
      input.markHouseholdDone,
    )
    try {
      await offline.hold({
        key: callKey,
        interaction: withCall
          ? { kind: 'call', payload: { listId, request } }
          : null,
        memo: memoFor(input),
      })
    } catch {
      // A call that already saved stays saved; only the recording is lost.
      if (withCall) setHoldFailed(true)
      return
    }
    if (withCall) {
      // Logged on the phone, so the list moves on now with what the server
      // will record for this person; the caller page re-reads the list once
      // the queue drains, which also settles anything this cannot know,
      // like the rest of a household marked done.
      onSaved([
        {
          personId,
          interaction: {
            outcome: request.outcome,
            supportAnswer: request.supportAnswer ?? null,
            willVote: request.willVote ?? null,
            followUp: request.followUp ?? null,
            occurredAt: new Date(),
          },
        },
      ])
      logCallAnalytics(input.draft)
    }
    setMemo('')
    setSpoken(false)
    setIsEditing(false)
    setQueued(withCall ? 'saved' : 'sending')
  }

  const saveMutation = useMutation({
    mutationFn: (input: SaveInput) =>
      clientRequest('POST /v1/phone-banking/lists/:id/calls', {
        id: String(listId),
        ...buildRecordCallRequest(
          entryId,
          input.draft,
          personId,
          input.markHouseholdDone,
        ),
      }).then((res) => res.data),
    onSuccess: async (data, input) => {
      // This save supersedes whatever the phone still held for the call, so
      // a later drain cannot send an older one over it.
      // Only where capture is on: with the flag off the form is exactly what
      // it was, and has queued nothing to supersede.
      if (captureEnabled) await offline.forget(callKey).catch(() => undefined)
      // The call is logged before the memo is even posted, and the panel is
      // told so immediately — unlike the door, where the walk is HELD at the
      // stop until the issues are answered. A caller picks their next entry
      // themselves, so there is nothing to hold, and leaving the list stale
      // while a second request runs would be the worse trade.
      onSaved(data.results)
      refreshReport()
      setIsEditing(false)
      logCallAnalytics(input.draft)
      // Re-editing this same call through the pencil toggles `isEditing` on a
      // live instance rather than remounting it (the key is personId), so
      // without these the second memo inherits the first one's text and is
      // reported as dictated even when it was typed.
      setMemo('')
      setSpoken(false)
      // Words win over a recording, as they do in the queue. A recording
      // made earlier with no signal, and no words, goes the offline way,
      // after the call it belongs to.
      if (input.capturesIssues && input.transcript.length > 0) {
        capture.mutate({
          transcript: input.transcript,
          captureMethod: input.captureMethod,
        })
      } else if (input.capturesIssues && input.recording !== null) {
        void hold(input, false)
      }
    },
    // A request that got no answer at all is a dead zone the browser has not
    // noticed: the call is held like any offline one.
    onError: (error, input) => {
      if (captureEnabled && isNetworkError(error)) void hold(input, true)
    },
  })

  // The one place the snapshot is taken, so the two Save presses cannot
  // disagree about what they froze.
  const save = (markHouseholdDone: boolean) => {
    const input: SaveInput = {
      markHouseholdDone,
      draft,
      capturesIssues,
      transcript: memo.trim(),
      captureMethod: spoken ? 'dictation' : 'typed',
      recording: offline.audio,
    }
    setHoldFailed(false)
    // No signal, or a socket that would not open for this call: a save sent
    // now would only fail, so it waits on the phone with its memo.
    if (captureEnabled && (!navigator.onLine || offline.fellBack)) {
      void hold(input, true)
      return
    }
    saveMutation.mutate(input)
  }

  const handleCancel = () => {
    setDraft(draftFromInteraction(interaction, isServe))
    setIsEditing(!interaction)
    offline.discard()
  }

  if (captured !== null) {
    return (
      <IssueCaptureConfirmCard
        proposed={captured.proposed}
        saving={confirmCapture.isPending}
        isServe={isServe}
        onConfirm={(issues) => confirmCapture.mutate(issues)}
        onSkip={() => {
          trackEvent(EVENTS.IssueCapture.MemoSkipped, {
            channel: 'phoneBanking',
            product,
          })
          setCaptured(null)
        }}
      />
    )
  }

  // Held on the phone with nothing the server has said back to summarize.
  if (queued !== null && !interaction) {
    return (
      <p className="text-sm text-muted-foreground">
        {OFFLINE_MEMO_COPY[queued]}
      </p>
    )
  }

  if (!isEditing && interaction) {
    return (
      <div className="flex flex-col gap-2">
        {queued !== null && (
          <p className="text-sm text-muted-foreground">
            {OFFLINE_MEMO_COPY[queued]}
          </p>
        )}
        {failedMemo !== null && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-destructive">
              Couldn&apos;t save what they said.
            </p>
            <Button
              variant="outline"
              size="small"
              disabled={capture.isPending}
              onClick={() => capture.mutate(failedMemo)}
            >
              Try again
            </Button>
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
              <span
                className={cn(
                  'size-2.5 rounded-full',
                  OUTCOME_DOT_CLASS[interaction.outcome],
                )}
              />
              {OUTCOME_LABEL[interaction.outcome]}
            </span>
            {/* Read off the interaction rather than the draft, so the surface
              has to be checked here too: a Serve list's existing rows carry
              the Win answers (it shipped asking them), and showing them back
              would put "Support: Yes" in front of the caller this change
              exists to stop asking. Gated symmetrically with the edit form
              below — each surface reads back only its own question. */}
            {interaction.outcome === 'answered' && (
              <>
                {!isServe && interaction.supportAnswer && (
                  <span className="truncate">
                    {' · Support: '}
                    <span className="font-medium text-foreground">
                      {SUPPORT_ANSWER_LABEL[interaction.supportAnswer]}
                    </span>
                  </span>
                )}
                {!isServe && interaction.willVote && (
                  <span className="truncate">
                    {' · Will vote: '}
                    <span className="font-medium text-foreground">
                      {WILL_VOTE_ANSWER_LABEL[interaction.willVote]}
                    </span>
                  </span>
                )}
                {isServe && interaction.followUp && (
                  <span className="truncate">
                    {' · Follow-up: '}
                    <span className="font-medium text-foreground">
                      {FOLLOW_UP_ANSWER_LABEL[interaction.followUp]}
                    </span>
                  </span>
                )}
              </>
            )}
          </div>
          <IconButton
            variant="outline"
            size="small"
            aria-label="Edit this call's outcome"
            className="shrink-0"
            onClick={() => setIsEditing(true)}
          >
            <PencilIcon size={16} />
          </IconButton>
        </div>
      </div>
    )
  }

  const showActions = isDraftComplete(draft, isServe)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Did they answer?
        </p>
        <div className="mt-2">
          <FilterPillGroup
            type="single"
            value={draft.outcome ?? ''}
            onValueChange={(value) =>
              setDraft((current) =>
                draftWithOutcome(
                  current,
                  (value || undefined) as typeof draft.outcome,
                ),
              )
            }
          >
            {OUTCOME_ORDER.map((outcome) => (
              <FilterPill key={outcome} value={outcome}>
                {OUTCOME_LABEL[outcome]}
              </FilterPill>
            ))}
          </FilterPillGroup>
        </div>
      </div>

      {draft.outcome === 'answered' && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Did they engage?
          </p>
          <div className="mt-2">
            <FilterPillGroup
              type="single"
              value={draft.engagement ?? ''}
              onValueChange={(value) =>
                setDraft((current) =>
                  draftWithEngagement(
                    current,
                    (value || undefined) as typeof draft.engagement,
                  ),
                )
              }
            >
              <FilterPill value="engaged">Engaged</FilterPill>
              <FilterPill value="refused">Refused</FilterPill>
              <FilterPill value="hung_up">Hung up</FilterPill>
            </FilterPillGroup>
          </div>
        </div>
      )}

      {draft.outcome === 'answered' && draft.engagement === 'engaged' && (
        <>
          {isServe ? (
            // Serve's whole engaged branch, and deliberately not a renaming of
            // Win's two: an elected official's caller has no stance to ask a
            // constituent about and no election to ask them about either, so
            // the one thing worth writing down is what the office owes them
            // afterwards. Same question, same answers, as a Serve door knock.
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Do they need follow-up?
              </p>
              <div className="mt-2">
                <FilterPillGroup
                  type="single"
                  value={draft.followUp ?? ''}
                  onValueChange={(value) =>
                    setDraft((current) =>
                      draftWithFollowUp(
                        current,
                        (value || undefined) as typeof draft.followUp,
                      ),
                    )
                  }
                >
                  <FilterPill value="yes">Yes</FilterPill>
                  <FilterPill value="no">No</FilterPill>
                </FilterPillGroup>
              </div>
            </div>
          ) : (
            <>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Do they support you?
                </p>
                <div className="mt-2">
                  <FilterPillGroup
                    type="single"
                    value={draft.supportAnswer ?? ''}
                    onValueChange={(value) =>
                      setDraft((current) =>
                        draftWithSupportAnswer(
                          current,
                          (value || undefined) as typeof draft.supportAnswer,
                        ),
                      )
                    }
                  >
                    <FilterPill value="supporter">Yes</FilterPill>
                    <FilterPill value="non_supporter">No</FilterPill>
                    <FilterPill value="unsure">Unsure</FilterPill>
                  </FilterPillGroup>
                </div>
              </div>

              {draft.supportAnswer !== undefined && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Will they vote this election?
                  </p>
                  <div className="mt-2">
                    <FilterPillGroup
                      type="single"
                      value={draft.willVote ?? ''}
                      onValueChange={(value) =>
                        setDraft((current) =>
                          draftWithWillVote(
                            current,
                            (value || undefined) as typeof draft.willVote,
                          ),
                        )
                      }
                    >
                      <FilterPill value="yes">Yes</FilterPill>
                      <FilterPill value="no">No</FilterPill>
                      <FilterPill value="unsure">Unsure</FilterPill>
                    </FilterPillGroup>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {capturesIssues && showActions && (
        <div>
          <span className="text-xs font-semibold uppercase tracking-[0.03em] text-muted-foreground">
            {MEMO_LABEL[product]}
          </span>
          <div className="relative mt-2">
            <Textarea
              value={memo}
              maxLength={CONSTITUENT_FEEDBACK_TRANSCRIPT_MAX_LENGTH}
              // Serve's names what to record, not just how: the extraction
              // reads for an issue and a position, so the prompt asks for
              // those rather than leaving the caller to guess what is useful.
              placeholder={MEMO_PLACEHOLDER[product]}
              rows={3}
              className="min-h-20 pr-12"
              onChange={(e) => setMemo(e.target.value)}
            />
            <DictationMicButton
              dictation={offline.mic}
              idleLabel="Dictate summary"
              recordingLabel="Stop dictation"
              disabled={saveMutation.isPending}
            />
          </div>
          {offline.audio !== null && (
            <p className="mt-2 text-xs text-muted-foreground">
              {OFFLINE_MEMO_COPY.recorded}
            </p>
          )}
          <DictationFeedback dictation={offline.mic} />
        </div>
      )}

      {showActions && (
        <div className="flex flex-col gap-2 pt-1">
          <Button
            className="w-full"
            disabled={saveMutation.isPending}
            loading={
              saveMutation.isPending &&
              saveMutation.variables?.markHouseholdDone === false
            }
            onClick={() => save(false)}
          >
            Save
          </Button>
          {draft.outcome === 'answered' &&
            draft.engagement === 'engaged' &&
            householdHasOthersUnlogged && (
              <Button
                variant="outline"
                className="w-full"
                disabled={saveMutation.isPending}
                loading={
                  saveMutation.isPending &&
                  saveMutation.variables?.markHouseholdDone === true
                }
                onClick={() => save(true)}
              >
                Save &amp; mark rest of household done
              </Button>
            )}
          <Button
            variant="outline"
            className="w-full"
            disabled={saveMutation.isPending}
            onClick={handleCancel}
          >
            Cancel
          </Button>
          {/* A network error with capture on is being held on the phone,
              not a failed save; `holdFailed` says so if holding fails too. */}
          {((saveMutation.isError &&
            !(captureEnabled && isNetworkError(saveMutation.error))) ||
            holdFailed) && (
            <p className="text-sm text-destructive">
              Couldn&apos;t save this call. Please try again.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
