'use client'

import { useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useDictationAppend } from 'app/dashboard/shared/dictation/useDictationAppend'
import { DictationMicButton } from 'app/dashboard/shared/dictation/DictationMicButton'
import { DictationFeedback } from 'app/dashboard/briefings/shared/DictationFeedback'
import { useServeIssueCaptureFlag } from 'app/shared/experiments/serveIssueCaptureFlag'
import IssueCaptureConfirmCard from 'app/dashboard/door-knocking/native/IssueCaptureConfirmCard'
import type {
  PhoneBankingCallResult,
  PhoneBankingInteraction,
  ConstituentFeedbackTriple,
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

  // Issue capture. Serve only, flag only, and only once the call is answered
  // — there is nothing to summarize about a voicemail.
  const { enabled: captureEnabled } = useServeIssueCaptureFlag()
  const [memo, setMemo] = useState('')
  const [spoken, setSpoken] = useState(false)
  const [captured, setCaptured] = useState<{
    id: string
    proposed: ConstituentFeedbackTriple | null
  } | null>(null)
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

  const capture = useMutation({
    mutationFn: (transcript: string) =>
      clientRequest('POST /v1/constituent-feedback', {
        channel: 'phone_bank',
        entryId,
        personId,
        clientKey: memoKeyRef.current,
        transcript,
        captureMethod: spoken ? 'dictation' : 'typed',
      }).then((res) => res.data),
    onSuccess: (data) => {
      trackEvent(EVENTS.ConstituentFeedback.IssueCaptured, {
        channel: 'phoneBanking',
        captureMethod: spoken ? 'dictation' : 'typed',
        extractionStatus: data.extractionStatus,
      })
      setCaptured({ id: data.id, proposed: data.extraction })
    },
  })

  const confirmCapture = useMutation({
    mutationFn: (triple: ConstituentFeedbackTriple) =>
      clientRequest('PATCH /v1/constituent-feedback/:id/confirm', {
        id: captured?.id ?? '',
        ...triple,
      }).then((res) => res.data),
    onSuccess: (_data, triple) => {
      trackEvent(EVENTS.ConstituentFeedback.IssueConfirmed, {
        channel: 'phoneBanking',
        // Whether the caller changed what the model proposed, never what
        // either of them said — a constituent's words are not analytics.
        corrected:
          triple.issueLabel !== (captured?.proposed?.issueLabel ?? null) ||
          triple.stance !== (captured?.proposed?.stance ?? null) ||
          triple.desiredOutcome !==
            (captured?.proposed?.desiredOutcome ?? null),
      })
    },
    // Dismiss either way: a failed confirm leaves the memo saved and
    // unconfirmed, which reporting already tells apart.
    onSettled: () => setCaptured(null),
  })

  // `answered` is only the branch INTO the engagement question, and two of
  // its three answers are non-conversations: a refused or hung-up call is a
  // person-attributed outcome, not something a constituent said. Capturing
  // there would file a memo about a conversation that did not happen.
  const capturesIssues =
    captureEnabled &&
    isServe &&
    draft.outcome === 'answered' &&
    draft.engagement === 'engaged'

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
      listId,
      contactId: personId,
      listRank: entrySeq,
      answerStatus: savedOutcome,
      engagementStatus: engagementStatusFor(savedOutcome),
      supportStatus: savedDraft.supportAnswer,
      voterStatus: savedDraft.willVote,
    })
  }

  const saveMutation = useMutation({
    mutationFn: (markHouseholdDone: boolean) =>
      clientRequest('POST /v1/phone-banking/lists/:id/calls', {
        id: String(listId),
        ...buildRecordCallRequest(entryId, draft, personId, markHouseholdDone),
      }).then((res) => res.data),
    onSuccess: (data) => {
      // The call is logged before the memo is even posted, and the panel is
      // told so immediately — unlike the door, where the walk is HELD at the
      // stop until the triple is answered. A caller picks their next entry
      // themselves, so there is nothing to hold, and leaving the list stale
      // while a second request runs would be the worse trade.
      onSaved(data.results)
      setIsEditing(false)
      logCallAnalytics(draft)
      const transcript = memo.trim()
      if (capturesIssues && transcript.length > 0) capture.mutate(transcript)
    },
  })

  const handleCancel = () => {
    setDraft(draftFromInteraction(interaction, isServe))
    setIsEditing(!interaction)
  }

  if (captured !== null) {
    return (
      <IssueCaptureConfirmCard
        proposed={captured.proposed}
        saving={confirmCapture.isPending}
        onConfirm={(triple) => confirmCapture.mutate(triple)}
        onSkip={() => {
          trackEvent(EVENTS.ConstituentFeedback.IssueSkipped, {
            channel: 'phoneBanking',
          })
          setCaptured(null)
        }}
      />
    )
  }

  if (!isEditing && interaction) {
    return (
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
            What did they say?
          </span>
          <div className="relative mt-2">
            <Textarea
              value={memo}
              maxLength={CONSTITUENT_FEEDBACK_TRANSCRIPT_MAX_LENGTH}
              placeholder="Say it out loud. We'll clean it up."
              rows={3}
              className="min-h-20 pr-12"
              onChange={(e) => setMemo(e.target.value)}
            />
            <DictationMicButton
              dictation={dictation}
              idleLabel="Dictate summary"
              recordingLabel="Stop dictation"
              disabled={saveMutation.isPending}
            />
          </div>
          <DictationFeedback dictation={dictation} />
        </div>
      )}

      {showActions && (
        <div className="flex flex-col gap-2 pt-1">
          <Button
            className="w-full"
            disabled={saveMutation.isPending}
            loading={saveMutation.isPending && saveMutation.variables === false}
            onClick={() => saveMutation.mutate(false)}
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
                  saveMutation.isPending && saveMutation.variables === true
                }
                onClick={() => saveMutation.mutate(true)}
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
          {saveMutation.isError && (
            <p className="text-sm text-destructive">
              Couldn&apos;t save this call. Please try again.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
