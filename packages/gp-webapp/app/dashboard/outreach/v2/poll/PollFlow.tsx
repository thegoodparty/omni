'use client'

import { useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import {
  PRICE_PER_TEXT,
  recommendedSampleSize,
  SMS_COMPOSED_MAX_LENGTH,
  POLL_QUESTION_MAX_LENGTH,
  POLL_QUESTION_MIN_LENGTH,
  POLL_TOPICS,
  type PollTone,
  type PollTopic,
  type ServePollAudience,
  type ServePollCreate,
} from '@goodparty_org/contracts'
import { Button, Card, cn } from '@styleguide'
import { CircleCheckIcon } from '@styleguide/components/ui/icons'
import { useUser } from '@shared/hooks/useUser'
import { usePositionName } from '@shared/hooks/usePositionName'
import { useTotalConstituentsWithCellPhone } from 'app/dashboard/polls/shared/audience-selection'
import { CheckoutSessionProvider } from 'app/dashboard/purchase/components/CheckoutSessionProvider'
import { PURCHASE_TYPES } from 'helpers/purchaseTypes'
import { hasAnyVoterFileSelection } from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import type { OutreachFlowSource } from 'app/dashboard/outreach/util/outreachAnalytics'
import { OUTREACH_TYPES } from 'app/dashboard/outreach/constants'
import { OutreachFlowShell, type FlowShellCta } from '../OutreachFlowShell'
import { ChannelBadge } from '../channelMeta'
import { OutreachAudienceStep } from '../audience/OutreachAudienceStep'
import { useOutreachAudience } from '../audience/useOutreachAudience'
import { ServeSmsScheduleStep } from '../sms/ServeSmsScheduleStep'
import { SmsReviewStep } from '../sms/SmsReviewStep'
import { PollTopicStep } from './PollTopicStep'
import { PollQuestionStep } from './PollQuestionStep'
import { composePollMessage, pollIntro } from './pollCompose.util'
import {
  DEFAULT_POLL_TONE,
  SERVE_POLL_AUDIENCE_COPY,
  SERVE_POLL_QUESTION_COPY,
  SERVE_POLL_RECOMMENDATION_COPY,
  SERVE_POLL_REVIEW_COPY,
  SERVE_POLL_SUCCESS_COPY,
} from './pollCopy'
import { draftPollQuestion, usePollCreate } from './usePollCreate'
import { usePollBiasCheck } from './usePollBiasCheck'

type StepId = 'topic' | 'audience' | 'question' | 'schedule' | 'review'

const STEP_ORDER: StepId[] = [
  'topic',
  'audience',
  'question',
  'schedule',
  'review',
]

const STEP_TITLES: Record<StepId, string> = {
  topic: 'What do you want to poll about?',
  audience: 'Who are you polling?',
  question: SERVE_POLL_QUESTION_COPY.title,
  schedule: 'When do you want to send it?',
  review: SERVE_POLL_REVIEW_COPY.title,
}

// Texts go to cell phones, so both counts use the cell dimension.
const POLL_COUNT_OVERLAY = { hasCellPhone: true }

const topicName = (topic: PollTopic | null): string =>
  topic === 'custom'
    ? 'Your own question'
    : (POLL_TOPICS.find((candidate) => candidate.id === topic)?.label ?? 'Poll')

const sampleAudienceName = 'Random sample of constituents'

const sendDateLabel = (date: Date): string =>
  date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

interface PollFlowProps {
  open: boolean
  onClose: () => void
  // Re-reads the outreach list: a paid poll only exists in history once the
  // server has held it, so there is no create response to seed a row from.
  onScheduled: () => Promise<void>
  source?: OutreachFlowSource
}

const SampleCard = ({
  size,
  selected,
  onSelect,
}: {
  size: number
  selected: boolean
  onSelect: () => void
}) => (
  <div className="space-y-2">
    <p className="text-xs font-bold uppercase text-primary">
      {SERVE_POLL_RECOMMENDATION_COPY.label}
    </p>
    <Card
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        'cursor-pointer gap-1 p-4 transition-colors',
        selected ? 'border-primary' : 'hover:border-primary/50',
      )}
    >
      <p className="font-medium text-foreground">
        {SERVE_POLL_RECOMMENDATION_COPY.title}
      </p>
      <p className="text-sm text-muted-foreground">
        {SERVE_POLL_RECOMMENDATION_COPY.reason}
      </p>
      <p className="text-sm font-medium text-foreground">
        {SERVE_POLL_RECOMMENDATION_COPY.reach(
          size.toLocaleString(),
          (size * PRICE_PER_TEXT).toFixed(2),
        )}
      </p>
    </Card>
  </div>
)

const PollSuccess = ({
  contactCount,
  sendAt,
  onDone,
}: {
  contactCount: number
  sendAt: Date | null
  onDone: () => void
}) => (
  <div className="space-y-6 py-8 text-center">
    <div className="flex justify-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-primary-light">
        <CircleCheckIcon className="size-8 text-primary" />
      </span>
    </div>
    <div className="space-y-2">
      <h2 className="text-2xl font-semibold text-foreground">
        {SERVE_POLL_SUCCESS_COPY.title}
      </h2>
      <p className="text-muted-foreground">{SERVE_POLL_SUCCESS_COPY.review}</p>
      {sendAt && (
        <p className="text-muted-foreground">
          {SERVE_POLL_SUCCESS_COPY.reach(
            contactCount.toLocaleString(),
            sendDateLabel(sendAt),
          )}
        </p>
      )}
    </div>
    <Button size="large" className="w-full" onClick={onDone}>
      {SERVE_POLL_SUCCESS_COPY.action}
    </Button>
  </div>
)

// Serve's self-serve poll: topic, who, what, when, then review and pay. Flat
// client state, nothing persists until review writes the pending_payment row,
// and reopening starts fresh. Serve has no texting verification gate and no
// 10DLC registration, so there is no gate step.
export const PollFlow = ({
  open,
  onClose,
  onScheduled,
  source = 'outreach_page',
}: PollFlowProps) => {
  const [user] = useUser()
  const positionName = usePositionName()
  const senderName = `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim()

  const [stepId, setStepId] = useState<StepId>('topic')
  const [topic, setTopic] = useState<PollTopic | null>(null)
  const [tone, setTone] = useState<PollTone>(DEFAULT_POLL_TONE)
  const [question, setQuestion] = useState('')
  // Whether the question came from the draft endpoint, so a poll the official
  // wrote entirely themselves does not report a tone they never used.
  const [drafted, setDrafted] = useState(false)
  // The question an AI rewrite (Regenerate, a tone, Improve) replaced, so
  // Undo can put it back. Unlike SMS and Social, it is kept even when the
  // words replaced were the AI's own draft.
  const [undoText, setUndoText] = useState<string | null>(null)
  // Set by a Continue press while it waits on the check. A check that
  // leaving the field started must not disable Continue: the press that
  // blurred the field lands after it, and would be swallowed.
  const [continuing, setContinuing] = useState(false)
  // Bumped by anything that replaces the question, so an Improve answering
  // for words that are gone is dropped rather than written over them.
  const improveRequestRef = useRef(0)
  const [drafting, setDrafting] = useState(false)
  const [draftError, setDraftError] = useState(false)
  const draftRequestRef = useRef(0)
  // What the last Improve came back with, when it did not replace the
  // question: a failure, or a rewrite identical to it.
  const [improveResult, setImproveResult] = useState<
    'error' | 'unchanged' | null
  >(null)
  const [imageUrl, setImageUrl] = useState<string | undefined>()
  const [questionContinueAttempts, setQuestionContinueAttempts] = useState(0)
  const [audienceKind, setAudienceKind] = useState<'sample' | 'list'>('sample')
  const [date, setDate] = useState<Date | undefined>()
  const [scheduled, setScheduled] = useState(false)

  const audience = useOutreachAudience({
    open,
    active: stepId === 'audience',
    reachabilityKey: 'sms',
    countOverlay: POLL_COUNT_OVERLAY,
  })
  const { reset: resetAudience } = audience
  const selectedList = audience.selectedList
  const constituents = useTotalConstituentsWithCellPhone()
  const sampleSize =
    constituents.data !== undefined
      ? recommendedSampleSize({ audience: constituents.data.totalConstituents })
      : 0
  const sampleAvailable = sampleSize > 0
  // A district with no count cannot offer the sample, so the list picker is
  // the only audience and the selection falls to it.
  const effectiveKind: 'sample' | 'list' = sampleAvailable
    ? audienceKind
    : 'list'

  const composedLength = composePollMessage(
    question.trim(),
    senderName,
    positionName,
  ).length
  const biasCheck = usePollBiasCheck(question)
  const biasFlagged = biasCheck.status === 'flagged'
  const { reset: resetBiasCheck } = biasCheck
  // What an async handler reads after its await, when the render that
  // started it is stale.
  const latestRef = useRef({ question, stepId })
  useEffect(() => {
    latestRef.current = { question, stepId }
  })

  // `prior` is what Undo would restore. A topic pick passes '' because the
  // previous topic's question, still in this render's state, is not the
  // official's to get back on the new topic.
  const runDraft = async (
    nextTopic: PollTopic,
    nextTone: PollTone,
    currentDraft: string | undefined,
    prior: string = question,
  ) => {
    const request = ++draftRequestRef.current
    improveRequestRef.current += 1
    setDrafting(true)
    setDraftError(false)
    try {
      const drafted = await draftPollQuestion({
        topic: nextTopic,
        tone: nextTone,
        ...(currentDraft && { currentDraft }),
      })
      if (request !== draftRequestRef.current) return
      setUndoText(prior.trim() && prior !== drafted ? prior : null)
      setQuestion(drafted)
      setDrafted(true)
      setImproveResult(null)
    } catch {
      if (request === draftRequestRef.current) setDraftError(true)
    } finally {
      if (request === draftRequestRef.current) setDrafting(false)
    }
  }

  const currentDraft = (): string | undefined =>
    question.trim().length >= POLL_QUESTION_MIN_LENGTH
      ? question.trim()
      : undefined

  const handleSelectTopic = (picked: PollTopic) => {
    setTopic(picked)
    setTone(DEFAULT_POLL_TONE)
    setQuestion('')
    setDrafted(false)
    setUndoText(null)
    setImproveResult(null)
    improveRequestRef.current += 1
    // A list picked on an earlier pass must not ride into this poll.
    setAudienceKind('sample')
    resetAudience()
    setStepId('audience')
    // A question the official writes themselves has nothing to draft from.
    if (picked === 'custom') {
      draftRequestRef.current += 1
      setDrafting(false)
      setDraftError(false)
      return
    }
    void runDraft(picked, DEFAULT_POLL_TONE, undefined, '')
  }

  const handleToneChange = (next: PollTone) => {
    setTone(next)
    if (topic) void runDraft(topic, next, currentDraft())
  }

  const handleRegenerate = () => {
    if (topic) void runDraft(topic, tone, currentDraft())
  }

  const scheduledAt = date ?? null
  const pollAudience: ServePollAudience | null =
    effectiveKind === 'sample'
      ? { kind: 'sample', size: sampleSize }
      : audience.selectedListId !== null
        ? { kind: 'list', voterFileFilterId: audience.selectedListId }
        : null

  const payload: ServePollCreate | null =
    topic && pollAudience && scheduledAt
      ? {
          topic,
          ...(drafted && { tone }),
          question: question.trim(),
          ...(imageUrl && { imageUrl }),
          audience: pollAudience,
          // A calendar day, not an instant: the send hour is fixed at 11am
          // local, and formatting the local date keeps an evening render from
          // rolling it forward the way toISOString() would.
          scheduledLocalDate: format(scheduledAt, 'yyyy-MM-dd'),
          biasOverridden: biasFlagged,
        }
      : null

  const pollCreate = usePollCreate({
    enabled: stepId === 'review' && open && !scheduled,
    payload,
  })
  const { created, discard: discardCreate } = pollCreate

  useEffect(() => {
    if (!open) return
    draftRequestRef.current += 1
    setStepId('topic')
    setTopic(null)
    setTone(DEFAULT_POLL_TONE)
    setQuestion('')
    setDrafted(false)
    setUndoText(null)
    setDrafting(false)
    setDraftError(false)
    setImproveResult(null)
    improveRequestRef.current += 1
    resetBiasCheck()
    setImageUrl(undefined)
    setQuestionContinueAttempts(0)
    setAudienceKind('sample')
    setDate(undefined)
    setScheduled(false)
    resetAudience()
    discardCreate()
  }, [open, resetAudience, resetBiasCheck, discardCreate])

  const stepIndex = STEP_ORDER.indexOf(stepId)

  const handleBack = () => {
    if (stepId === 'audience' && audience.mode === 'name') {
      audience.clearCreateError()
      audience.setMode('filters')
      return
    }
    if (stepId === 'audience' && audience.mode === 'filters') {
      audience.resetBuilder()
      return
    }
    // Back off review discards the row, so re-entry prices the edited poll.
    if (stepId === 'review') pollCreate.discard()
    const previous = STEP_ORDER[stepIndex - 1]
    if (previous) setStepId(previous)
  }

  const handleCreateListContinue = async () => {
    if (audience.builderName.trim().length === 0 || audience.createListPending)
      return
    try {
      await audience.createList()
      setAudienceKind('list')
      setStepId('question')
    } catch {
      // audience.createListError renders the inline message in the step.
    }
  }

  const handleImprove = async () => {
    setImproveResult(null)
    const prior = question
    const request = ++improveRequestRef.current
    const improved = await biasCheck.improve()
    if (request !== improveRequestRef.current) return
    if (!improved) {
      setImproveResult('error')
      return
    }
    // The analyzer hands back a question it finds nothing to fix in as it
    // was; say so rather than leave the press looking like it did nothing.
    if (improved.trim() === prior.trim()) {
      setImproveResult('unchanged')
      return
    }
    setUndoText(prior.trim() && prior !== improved ? prior : null)
    setQuestion(improved)
  }

  const handleQuestionChange = (next: string) => {
    improveRequestRef.current += 1
    setQuestion(next)
    setUndoText(null)
    setImproveResult(null)
  }

  const handleUndo = () => {
    if (undoText === null) return
    // The words being restored win over a draft still on its way.
    draftRequestRef.current += 1
    improveRequestRef.current += 1
    setDrafting(false)
    setQuestion(undoText)
    setUndoText(null)
  }

  const handleQuestionContinue = async () => {
    const trimmed = question.trim().length
    const ready =
      !drafting &&
      trimmed >= POLL_QUESTION_MIN_LENGTH &&
      question.trim().length <= POLL_QUESTION_MAX_LENGTH &&
      composedLength <= SMS_COMPOSED_MAX_LENGTH
    if (!ready) {
      setQuestionContinueAttempts((n) => n + 1)
      return
    }
    // A question nobody has checked yet is checked now. A flagged question
    // cannot go on until it is reworded; a check that failed lets it go, so
    // an outage never strands the official.
    const checked = question
    setContinuing(true)
    const settled = await biasCheck
      .ensureChecked()
      .finally(() => setContinuing(false))
    // The field stays editable and Back stays live while the check runs; a
    // verdict on words that changed, or a step the official left, decides
    // nothing.
    const now = latestRef.current
    if (now.question !== checked || now.stepId !== 'question') return
    if (settled === 'flagged') return
    setStepId('schedule')
  }

  const handleComplete = async () => {
    setScheduled(true)
    await onScheduled()
  }

  const reachableCount = audience.reachableCount
  const cta: FlowShellCta | null = scheduled
    ? null
    : stepId === 'audience' && audience.mode === 'filters'
      ? {
          label: audience.builderCounting
            ? 'Continue'
            : `Continue (${(audience.builderCount ?? 0).toLocaleString()})`,
          onClick: () => audience.setMode('name'),
          disabled:
            !hasAnyVoterFileSelection(
              audience.builderFilters,
              audience.builderSupportStatus,
              audience.builderPrecincts,
            ) ||
            audience.builderCounting ||
            audience.builderZeroMatch ||
            audience.builderCapError,
        }
      : stepId === 'audience' && audience.mode === 'name'
        ? {
            label: 'Continue',
            onClick: () => {
              void handleCreateListContinue()
            },
            disabled: audience.builderName.trim().length === 0,
            loading: audience.createListPending,
          }
        : stepId === 'audience'
          ? {
              label:
                effectiveKind === 'sample'
                  ? `Continue (${sampleSize.toLocaleString()})`
                  : reachableCount !== null
                    ? `Continue (${reachableCount.toLocaleString()})`
                    : 'Continue',
              onClick: () => setStepId('question'),
              disabled:
                effectiveKind === 'sample'
                  ? false
                  : !selectedList ||
                    audience.reachableLoading ||
                    reachableCount === null ||
                    reachableCount === 0,
            }
          : stepId === 'question'
            ? {
                label: 'Continue',
                onClick: handleQuestionContinue,
                disabled: drafting || biasCheck.improving || biasFlagged,
                // A press that started the check shows it working rather than
                // a button that looks switched off.
                loading: continuing,
              }
            : stepId === 'schedule'
              ? {
                  label: 'Continue',
                  onClick: () => setStepId('review'),
                  disabled: scheduledAt === null,
                }
              : null

  const intro = pollIntro(senderName, positionName)
  const audienceName =
    effectiveKind === 'sample'
      ? sampleAudienceName
      : (selectedList?.name ?? 'Saved list')

  return (
    <OutreachFlowShell
      open={open}
      onClose={onClose}
      title={scheduled ? 'Done' : STEP_TITLES[stepId]}
      headerBadge={<ChannelBadge type="poll" />}
      source={source}
      settled={scheduled}
      currentStep={stepIndex + 1}
      totalSteps={scheduled ? 0 : STEP_ORDER.length}
      onBack={!scheduled && stepIndex > 0 ? handleBack : undefined}
      cta={cta}
      dirty={!scheduled && topic !== null}
    >
      {scheduled ? (
        <PollSuccess
          contactCount={created?.recipientCount ?? 0}
          sendAt={scheduledAt}
          onDone={onClose}
        />
      ) : stepId === 'topic' ? (
        <PollTopicStep selected={topic} onSelect={handleSelectTopic} />
      ) : stepId === 'audience' ? (
        <>
          <OutreachAudienceStep
            channel="text"
            copy={SERVE_POLL_AUDIENCE_COPY}
            leadCard={
              sampleAvailable ? (
                <SampleCard
                  size={sampleSize}
                  selected={effectiveKind === 'sample'}
                  onSelect={() => setAudienceKind('sample')}
                />
              ) : undefined
            }
            mode={audience.mode}
            lists={audience.lists}
            listsLoading={audience.listsLoading}
            selectedId={
              effectiveKind === 'list' ? audience.selectedListId : null
            }
            onSelect={(id) => {
              audience.onSelect(id)
              setAudienceKind('list')
            }}
            universeName={audience.universeName}
            universeListId={audience.universeListId}
            universeCount={audience.universeCount}
            universeLoading={audience.universeLoading}
            onSelectUniverse={audience.selectUniverse}
            universePending={audience.universePending}
            universeError={audience.universeError}
            onPickerOpenChange={audience.onPickerOpenChange}
            onStartBuilder={audience.startBuilder}
            recommendations={audience.recommendations}
            recommendationsLoading={audience.recommendationsLoading}
            recommendationsError={audience.recommendationsError}
            recommendedListsChannel={audience.recommendedListsChannel}
            onCreateRecommendedList={async (recommendation, listName) => {
              await audience.createRecommendedList(recommendation, listName)
            }}
            onRecommendationReused={audience.trackRecommendationReused}
            selectedRecommendation={audience.selectedRecommendation}
            onSelectRecommendation={audience.selectRecommendation}
            createRecommendedListError={audience.createRecommendedListError}
            preselectedRecommendation={audience.preselectedRecommendation}
            preselectedRecommendationApplied={
              audience.preselectedRecommendationApplied
            }
            onPreselectedRecommendationApplied={
              audience.markPreselectedRecommendationApplied
            }
            reachableCount={reachableCount}
            reachableLoading={audience.reachableLoading}
            pricePerContact={PRICE_PER_TEXT}
            builderFilters={audience.builderFilters}
            onBuilderFiltersChange={audience.setBuilderFilters}
            builderSupportStatus={audience.builderSupportStatus}
            builderPrecincts={audience.builderPrecincts}
            onBuilderPrecinctsChange={audience.setBuilderPrecincts}
            precinctOptions={audience.precinctOptions}
            onBuilderSupportStatusChange={audience.setBuilderSupportStatus}
            builderName={audience.builderName}
            onBuilderNameChange={audience.setBuilderName}
            isElectedOfficial={audience.isElectedOfficial}
            civicPanel={audience.civicPanel}
            builderCount={audience.builderCount}
            builderCounting={audience.builderCounting}
            builderCapError={audience.builderCapError}
            builderCountErrorMessage={audience.builderCountErrorMessage}
          />
          {audience.createListError && (
            <p className="mt-4 text-sm text-destructive">
              We couldn&apos;t save this list. Try again.
            </p>
          )}
        </>
      ) : stepId === 'question' ? (
        <PollQuestionStep
          tone={tone}
          onToneChange={handleToneChange}
          question={question}
          onQuestionChange={handleQuestionChange}
          canUndo={undoText !== null}
          onUndo={handleUndo}
          intro={intro}
          suggestedFor={topic !== 'custom' || drafted ? audienceName : null}
          composedLength={composedLength}
          onRegenerate={handleRegenerate}
          canRegenerate={topic !== 'custom' || currentDraft() !== undefined}
          drafting={drafting}
          draftError={draftError}
          biasStatus={biasCheck.status}
          flaggedSpans={biasCheck.flaggedSpans}
          onCheckBias={() => void biasCheck.check()}
          onQuestionBlur={biasCheck.checkOnLeave}
          onImprove={() => void handleImprove()}
          improving={biasCheck.improving}
          improveResult={improveResult}
          imageUrl={imageUrl}
          onImageChange={setImageUrl}
          showValidation={questionContinueAttempts > 0}
        />
      ) : stepId === 'schedule' ? (
        <ServeSmsScheduleStep date={date} onDateChange={setDate} />
      ) : (
        <CheckoutSessionProvider
          key={created?.outreachId ?? 'pending'}
          type={PURCHASE_TYPES.SERVE_TEXT}
          purchaseMetaData={{
            contactCount: created?.recipientCount ?? 0,
            outreachType: OUTREACH_TYPES.text,
            outreachId: created?.outreachId,
          }}
        >
          <SmsReviewStep
            isServe
            channelLabel={SERVE_POLL_REVIEW_COPY.channelLabel}
            copy={SERVE_POLL_REVIEW_COPY}
            name={topicName(topic)}
            audienceName={audienceName}
            sendAt={scheduledAt ?? new Date()}
            composedMessage={composePollMessage(
              question.trim(),
              senderName,
              positionName,
            )}
            imagePreviewUrl={imageUrl ?? null}
            contactCount={created?.recipientCount ?? null}
            pricePerContact={PRICE_PER_TEXT}
            outreachId={created?.outreachId ?? null}
            phoneListBuildId={null}
            excludedOptedOutCount={null}
            excludedDuplicatePhoneCount={null}
            preparing={created === null && !pollCreate.failed}
            prepareError={pollCreate.failed}
            onComplete={handleComplete}
          />
        </CheckoutSessionProvider>
      )}
    </OutreachFlowShell>
  )
}
