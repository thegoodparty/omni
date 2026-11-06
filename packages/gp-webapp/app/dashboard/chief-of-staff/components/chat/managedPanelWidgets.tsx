import { useEffect, useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  MANAGED_CIVIC_PANEL_HOW_IT_WORKS,
  SHOW_MANAGED_CIVIC_PANEL_INVITE,
  type ChatClarifyQuestion,
} from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { useUser } from '@shared/hooks/useUser'
import { usePositionName } from '@shared/hooks/usePositionName'
import { useOrganization } from '@shared/organization-picker'
import { grammarizeOfficeName } from 'app/polls/onboarding/utils/grammarizeOfficeName'
import ClarifyQuestionWidget from '../../../shared/agent-chat/ClarifyQuestionWidget'
import {
  MANAGED_PANEL_OFFER_TOOL,
  type ClarifyWidgetContext,
} from '../../../shared/agent-chat/clarifyWidget'
import { defineWidgetTool } from '../../../shared/agent-chat/widgetRegistry'
import { REACH_THE_REST_OFFER_TOOL } from '../../../shared/agent-chat/clarifyWidget'
import { ReachTheRestOffer } from './ReachTheRestOffer'
import {
  CompactCardLink,
  CompactCardLoading,
  CompactCardStatic,
  CompactCardUnavailable,
} from '../../../shared/agent-chat/cards/cardShell'
import { civicPanelHref } from '../../../contacts/citizens-panel/citizensPanelCopy'
import { managedCivicPanelQueryOptions } from '../../../contacts/citizens-panel/civicPanelSummary.query'
import {
  MANAGED_PANEL_COPY,
  useServePlace,
} from '../../../contacts/citizens-panel/managedPanelCopy'
import { SERVE_SMS_SURFACE, SmsFlow } from '../../../outreach/v2/sms/SmsFlow'
import {
  composeManagedInvite,
  managedInviteDraft,
} from '../../../outreach/v2/sms/smsCompose.util'

export const MANAGED_PANEL_INVITE_TOOL = 'present_managed_panel_invite'
export const MANAGED_PANEL_TOOL = 'present_managed_panel'
export const EXPLAIN_MANAGED_PANEL_TOOL = 'explain_managed_panel'

// What the invite review tells the conversation when it closes.
export type ManagedPanelWidgetContext = {
  onManagedPanelInviteClosed: (setUp: boolean) => void
}

// Fixed words, so the app draws the offer rather than the model writing it.
export const MANAGED_PANEL_OFFER_QUESTION: ChatClarifyQuestion = {
  questionId: 'managed_civic_panel_offer',
  question: MANAGED_PANEL_COPY.offerQuestion,
  options: [
    { label: SHOW_MANAGED_CIVIC_PANEL_INVITE },
    { label: MANAGED_CIVIC_PANEL_HOW_IT_WORKS },
    { label: MANAGED_PANEL_COPY.notNow },
  ],
  multiSelect: false,
}

// Offered again once How does it work? is answered, without it.
export const MANAGED_PANEL_OFFER_AFTER_HOW_IT_WORKS: ChatClarifyQuestion = {
  ...MANAGED_PANEL_OFFER_QUESTION,
  questionId: 'managed_civic_panel_offer_after_how_it_works',
  options: [
    { label: SHOW_MANAGED_CIVIC_PANEL_INVITE },
    { label: MANAGED_PANEL_COPY.notNow },
  ],
}

// The call itself is the widget. A refused call persists null args and
// renders nothing.
const isCall = (args: unknown): args is object =>
  args !== null && typeof args === 'object'

const isHowItWorks = (args: unknown): boolean =>
  isCall(args) && 'part' in args && args.part === 'how_it_works'

const isAfterHowItWorks = (args: object): boolean =>
  'afterHowItWorks' in args && args.afterHowItWorks === true

// Where the official asked for the explainer from, for its Viewed event.
export type ManagedExplainerSource = 'home_card' | 'intro_next_step' | 'chat'

// The first offer under the explanation, not the one after How does it
// work?: it is what tells the explainer was shown.
export const isManagedExplainerOffer = (
  toolName: string,
  args: unknown,
): boolean =>
  toolName === MANAGED_PANEL_OFFER_TOOL &&
  isCall(args) &&
  !isAfterHowItWorks(args)

// How the official answered the offer, for Explainer Completed.
export const managedExplainerChoice = (
  answer: string,
): 'show_invite' | 'how_it_works' | 'not_now' | 'wrote_own' => {
  const picked = answer.trim()
  if (picked === SHOW_MANAGED_CIVIC_PANEL_INVITE) return 'show_invite'
  if (picked === MANAGED_CIVIC_PANEL_HOW_IT_WORKS) return 'how_it_works'
  if (picked === MANAGED_PANEL_COPY.notNow) return 'not_now'
  return 'wrote_own'
}

// The invite in the official's name: their full name, office and place.
const useManagedInviteDraft = (): string => {
  const [user] = useUser()
  const office = grammarizeOfficeName(usePositionName())
  const place = useServePlace()
  const name = `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim()
  return managedInviteDraft({ name, office, place })
}

const isSetUp = (status: string | undefined): boolean =>
  status !== undefined && status !== 'stopped'

// Each invite card's review, by tool call. The streamed turn is swapped for
// the saved one when it ends, which remounts the card, so a review it opens
// on its own (pending until the civic panel is read) has to outlive the
// instance that started it.
type InviteReview = 'pending' | 'open' | 'closed'
const inviteReviews = new Map<string, InviteReview>()

// Like the other text cards in chat: what it is, who it goes to, and the one
// way forward. The words are on the review step, where they can be changed.
export const ManagedPanelInviteCard = ({
  onClosed,
  live = false,
  toolCallId = null,
}: {
  onClosed: (setUp: boolean) => void
  // Drawn by the turn streaming now, rather than replayed from history.
  live?: boolean
  toolCallId?: string | null
}) => {
  const place = useServePlace()
  const draft = useManagedInviteDraft()
  // Counted as the flow counts it, so Viewed and Submitted agree.
  const [viewedInvite] = useState(() => composeManagedInvite(draft))
  useEffect(() => {
    if (!live) return
    trackEvent(EVENTS.Contacts.CivicPanelInviteViewed, {
      inviteChars: viewedInvite.length,
      inviteSegments: Math.max(1, Math.ceil(viewedInvite.length / 160)),
    })
  }, [live, viewedInvite])
  const orgSlug = useOrganization()?.slug
  const { data: panel, isSuccess } = useQuery({
    ...managedCivicPanelQueryOptions(orgSlug),
    enabled: Boolean(orgSlug),
  })
  // The official already picked Review the invite to get this turn, so a
  // fresh card opens the review itself; replayed history waits for a press.
  const [review, setReview] = useState<InviteReview>(() => {
    const known =
      toolCallId === null ? undefined : inviteReviews.get(toolCallId)
    return known ?? (live ? 'pending' : 'closed')
  })
  const open = review === 'open'
  const setOpen = (next: boolean) => {
    const value = next ? 'open' : 'closed'
    if (toolCallId !== null) inviteReviews.set(toolCallId, value)
    setReview(value)
  }
  useEffect(() => {
    if (toolCallId !== null && !inviteReviews.has(toolCallId)) {
      inviteReviews.set(toolCallId, review)
    }
  }, [toolCallId, review])
  const setUp = isSetUp(panel?.status)
  useEffect(() => {
    if (review !== 'pending' || !isSuccess) return
    if (isSetUp(panel?.status)) {
      if (toolCallId !== null) inviteReviews.set(toolCallId, 'closed')
      setReview('closed')
      return
    }
    if (toolCallId !== null) inviteReviews.set(toolCallId, 'open')
    trackEvent(EVENTS.Contacts.CivicPanelInviteReviewViewed, {
      source: 'chat_offer',
    })
    setReview('open')
  }, [review, isSuccess, panel, toolCallId])

  return (
    <div className="w-full max-w-md" data-testid="managed-panel-invite">
      <CompactCardStatic
        title={MANAGED_PANEL_COPY.inviteCardTitle}
        subtitle={MANAGED_PANEL_COPY.inviteCardSubtitle(place)}
        action={
          setUp ? undefined : (
            <Button
              type="button"
              size="small"
              className="shrink-0"
              onClick={() => {
                trackEvent(EVENTS.Contacts.CivicPanelInviteReviewViewed, {
                  source: 'chat_card',
                })
                setOpen(true)
              }}
            >
              {MANAGED_PANEL_COPY.reviewInvite}
            </Button>
          )
        }
      />
      {open ? (
        <SmsFlow
          open
          surface={SERVE_SMS_SURFACE}
          source="deep_link"
          initialScript={draft}
          managedInvite={{
            place,
            onSetUp: () => {
              setOpen(false)
              onClosed(true)
            },
          }}
          onClose={() => {
            setOpen(false)
            onClosed(false)
          }}
          onScheduled={async () => undefined}
        />
      ) : null}
    </div>
  )
}

// The panel GoodParty is building, read live: its status and members of
// its goal, opening the panel page.
export const ManagedPanelCard = () => {
  const orgSlug = useOrganization()?.slug
  const {
    data: panel,
    isPending,
    isError,
  } = useQuery({
    ...managedCivicPanelQueryOptions(orgSlug),
    enabled: Boolean(orgSlug),
  })
  if (isPending) return <CompactCardLoading />
  if (isError || !panel) return <CompactCardUnavailable />
  return (
    <CompactCardLink
      title={MANAGED_PANEL_COPY.panelCardTitle}
      subtitle={MANAGED_PANEL_COPY.panelCardStatus(
        panel.status,
        panel.progress.members,
        panel.progress.goalMembers,
      )}
      href={civicPanelHref('chief_of_staff_chat')}
    />
  )
}

const VIDEO_CLASS = 'bg-muted w-full rounded-xl object-cover'

// Who gets the mic, over the answer to How does it work?: the landscape cut
// from md up, the square one below. Never autoplays.
export const ManagedPanelVideo = () => {
  const textId = useId()
  const cut = (shape: 'landscape' | 'square', className: string) => (
    <video
      controls
      playsInline
      preload="metadata"
      poster={`/videos/who-gets-the-mic-${shape}.jpg`}
      aria-label={MANAGED_PANEL_COPY.video.label}
      aria-describedby={textId}
      className={`${VIDEO_CLASS} ${className}`}
    >
      <source src={`/videos/who-gets-the-mic-${shape}.mp4`} type="video/mp4" />
    </video>
  )
  return (
    <div className="w-full max-w-md" data-testid="managed-panel-video">
      {cut('landscape', 'hidden aspect-video md:block')}
      {cut('square', 'aspect-square md:hidden')}
      <p id={textId} className="sr-only">
        {MANAGED_PANEL_COPY.video.textAlternative}
      </p>
    </div>
  )
}

export const managedPanelWidgetTools = [
  // Only the How does it work? answer carries the video. The explanation
  // after Build my civic panel stays a pill.
  defineWidgetTool({
    toolName: EXPLAIN_MANAGED_PANEL_TOOL,
    parse: (args) => (isHowItWorks(args) ? {} : null),
    render: () => <ManagedPanelVideo />,
    onParseFailure: 'inline',
  }),
  defineWidgetTool({
    toolName: MANAGED_PANEL_OFFER_TOOL,
    parse: (args) =>
      isCall(args)
        ? isAfterHowItWorks(args)
          ? MANAGED_PANEL_OFFER_AFTER_HOW_IT_WORKS
          : MANAGED_PANEL_OFFER_QUESTION
        : null,
    render: (
      question,
      {
        clarifyInteractive,
        clarifyAnswer,
        onClarifyAnswer,
      }: ClarifyWidgetContext,
    ) => (
      <ClarifyQuestionWidget
        question={question}
        disabled={!clarifyInteractive}
        answer={clarifyAnswer}
        onAnswer={onClarifyAnswer}
        showWrittenAnswer={false}
      />
    ),
  }),
  defineWidgetTool({
    toolName: MANAGED_PANEL_INVITE_TOOL,
    parse: (args) => (isCall(args) ? {} : null),
    render: (
      _data,
      { onManagedPanelInviteClosed }: ManagedPanelWidgetContext,
      call,
    ) => (
      <ManagedPanelInviteCard
        onClosed={onManagedPanelInviteClosed}
        live={call.messageId === null}
        toolCallId={call.toolCallId}
      />
    ),
  }),
  defineWidgetTool({
    toolName: MANAGED_PANEL_TOOL,
    parse: (args) => (isCall(args) ? {} : null),
    render: () => <ManagedPanelCard />,
  }),
  defineWidgetTool({
    toolName: REACH_THE_REST_OFFER_TOOL,
    parse: (args) => (isCall(args) ? {} : null),
    render: (
      _data,
      {
        clarifyInteractive,
        clarifyAnswer,
        onClarifyAnswer,
      }: ClarifyWidgetContext,
    ) => (
      <ReachTheRestOffer
        disabled={!clarifyInteractive}
        answer={clarifyAnswer}
        onAnswer={onClarifyAnswer}
      />
    ),
  }),
]
