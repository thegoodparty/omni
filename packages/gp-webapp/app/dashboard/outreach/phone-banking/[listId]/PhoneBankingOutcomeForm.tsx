'use client'

import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type {
  PhoneBankingCallResult,
  PhoneBankingInteraction,
} from '@goodparty_org/contracts'
import {
  Button,
  FilterPill,
  FilterPillGroup,
  IconButton,
  PencilIcon,
  cn,
} from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import {
  OUTCOME_DOT_CLASS,
  OUTCOME_LABEL,
  OUTCOME_ORDER,
  SUPPORT_ANSWER_LABEL,
  WILL_VOTE_ANSWER_LABEL,
  buildRecordCallRequest,
  draftFromInteraction,
  draftWithEngagement,
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
  onSaved,
}: PhoneBankingOutcomeFormProps): React.JSX.Element {
  const [draft, setDraft] = useState<PhoneBankingOutcomeDraft>(() =>
    draftFromInteraction(interaction),
  )
  // Summary state once something is saved; the cascade form reopens only on
  // Edit — mirrors the canvas's sticky log-call bar.
  const [isEditing, setIsEditing] = useState(!interaction)

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
      onSaved(data.results)
      setIsEditing(false)
      logCallAnalytics(draft)
    },
  })

  const handleCancel = () => {
    setDraft(draftFromInteraction(interaction))
    setIsEditing(!interaction)
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
          {interaction.outcome === 'answered' && (
            <>
              {interaction.supportAnswer && (
                <span className="truncate">
                  {' · Support: '}
                  <span className="font-medium text-foreground">
                    {SUPPORT_ANSWER_LABEL[interaction.supportAnswer]}
                  </span>
                </span>
              )}
              {interaction.willVote && (
                <span className="truncate">
                  {' · Will vote: '}
                  <span className="font-medium text-foreground">
                    {WILL_VOTE_ANSWER_LABEL[interaction.willVote]}
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

  const showActions = isDraftComplete(draft)

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
