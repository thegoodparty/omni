import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  MANAGED_CIVIC_PANEL_HOW_IT_WORKS,
  SHOW_MANAGED_CIVIC_PANEL_INVITE,
  type ChatClarifyQuestion,
} from '@goodparty_org/contracts'
import { Button, cn } from '@styleguide'
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
import { OPTION_CARD_CLASS } from '../../../shared/agent-chat/optionCard'
import {
  CompactCardLink,
  CompactCardLoading,
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
  withSampleFirstName,
} from '../../../outreach/v2/sms/smsCompose.util'

export const MANAGED_PANEL_INVITE_TOOL = 'present_managed_panel_invite'
export const MANAGED_PANEL_TOOL = 'present_managed_panel'

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

// The invite in the official's name: its first name, their office.
const useManagedInviteDraft = (): string => {
  const [user] = useUser()
  const office = grammarizeOfficeName(usePositionName())
  return managedInviteDraft({ firstName: user?.firstName ?? '', office })
}

const isSetUp = (status: string | undefined): boolean =>
  status !== undefined && status !== 'stopped'

// The invite as residents would read it, with a sample first name, and the
// one way forward: review it in the text flow, which approves it there.
export const ManagedPanelInviteCard = ({
  onClosed,
  live = false,
}: {
  onClosed: (setUp: boolean) => void
  // Drawn by the turn streaming now, rather than replayed from history.
  live?: boolean
}) => {
  const place = useServePlace()
  const draft = useManagedInviteDraft()
  const composed = composeManagedInvite(draft)
  const invite = withSampleFirstName(composed)
  // Counted as the flow counts it, so Viewed and Submitted agree.
  const [viewedInvite] = useState(composed)
  useEffect(() => {
    if (!live) return
    trackEvent(EVENTS.CivicPanel.ManagedInviteViewed, {
      inviteChars: viewedInvite.length,
      inviteSegments: Math.max(1, Math.ceil(viewedInvite.length / 160)),
    })
  }, [live, viewedInvite])
  const orgSlug = useOrganization()?.slug
  const { data: panel } = useQuery({
    ...managedCivicPanelQueryOptions(orgSlug),
    enabled: Boolean(orgSlug),
  })
  const [open, setOpen] = useState(false)
  const setUp = isSetUp(panel?.status)

  return (
    <div
      className={cn(OPTION_CARD_CLASS, 'flex w-full max-w-md flex-col gap-3')}
      data-testid="managed-panel-invite"
    >
      <div className="flex flex-col">
        <span className="text-sm font-medium text-foreground">
          {MANAGED_PANEL_COPY.inviteCardTitle}
        </span>
        <span className="text-sm leading-6 text-muted-foreground">
          {MANAGED_PANEL_COPY.inviteCardSubtitle(place)}
        </span>
      </div>
      <p className="whitespace-pre-line rounded-lg bg-muted p-3 text-sm text-foreground">
        {invite}
      </p>
      {setUp ? null : (
        <Button
          type="button"
          size="large"
          className="w-full"
          onClick={() => {
            trackEvent(EVENTS.CivicPanel.ManagedInviteReviewViewed, {
              source: 'chat_card',
            })
            setOpen(true)
          }}
        >
          {MANAGED_PANEL_COPY.reviewInvite}
        </Button>
      )}
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

export const managedPanelWidgetTools = [
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
      />
    ),
  }),
  defineWidgetTool({
    toolName: MANAGED_PANEL_TOOL,
    parse: (args) => (isCall(args) ? {} : null),
    render: () => <ManagedPanelCard />,
  }),
]
