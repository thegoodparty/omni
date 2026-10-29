'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { parseISO } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { useMutation, useQuery } from '@tanstack/react-query'
import type {
  OutreachDetail,
  OutreachEventDetails,
  OutreachReceipt,
  ProposalEvent,
  RecommendedList,
  RecommendedListVariant,
  ServeSmsDraftRequest,
  SmsDraftRequest,
  SmsPurpose,
  SmsStandardsRule,
  SocialTone,
  ProposalLink,
} from '@goodparty_org/contracts'
import type { TcrCompliance } from 'helpers/types'
import {
  BUILD_CITIZENS_PANEL_PURPOSE,
  checkSmsStandards,
  findSmsRestrictedWords,
  findCivicPanelJoinLine,
  MANAGED_CIVIC_PANEL_CONSENT_VERSION,
  mergeTagToken,
  PRICE_PER_TEXT,
  REPORT_BACK_PURPOSE,
  SMS_COMPOSED_MAX_LENGTH,
  type ServeSmsCreateResponse,
} from '@goodparty_org/contracts'
import { Button, Card } from '@styleguide'
import {
  CircleCheckIcon,
  DownloadIcon,
  MessagesSquareIcon,
} from '@styleguide/components/ui/icons'
import { clientRequest } from 'gpApi/typed-request'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import {
  outreachEventProps,
  type OutreachFlowSource,
  type OutreachLaunchSource,
  type OutreachTrackerOrigin,
} from '../../util/outreachAnalytics'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useUser } from '@shared/hooks/useUser'
import { LongPoll } from '@shared/utils/LongPoll'
import {
  createP2pPhoneList,
  getP2pPhoneListBuildStatus,
  type PhoneListBuildStatusResult,
  type PhoneListResponse,
  type PhoneListResult,
  type PhoneListStatusResponse,
} from 'helpers/createP2pPhoneList'
import { createOutreach } from 'helpers/createOutreach'
import { createOutreachDraft } from 'helpers/createOutreachDraft'
import { useWinSmsHoldFlag } from 'app/shared/experiments/winSmsHoldFlag'
import { CheckoutSessionProvider } from 'app/dashboard/purchase/components/CheckoutSessionProvider'
import {
  OUTREACH_TYPES,
  FREE_TEXTS_OFFER,
} from 'app/dashboard/outreach/constants'
import { PURCHASE_TYPES } from 'helpers/purchaseTypes'
import { hasAnyVoterFileSelection } from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import { ChannelBadge } from '../channelMeta'
import { OutreachFlowShell, type FlowShellCta } from '../OutreachFlowShell'
import {
  combineScheduledAt,
  resolveCampaignTimeZone,
} from '../robocall/scheduleTimeZone'
import {
  OutreachAudienceStep,
  type OutreachAudienceCopy,
} from '../audience/OutreachAudienceStep'
import {
  intentForOutreachPurpose,
  useOutreachAudience,
  type ProposedAudience,
} from '../audience/useOutreachAudience'
import { purposeForRecommendedVariant } from '../audience/recommendedListMapping.util'
import { outreachLandingStep } from '../landingStep'
import { REVIEW_GATE_CTA } from '../gate/gateCopy'
import { useLockedAtOpen } from '../gate/useLockedAtOpen'
import { GateBanner } from '../gate/GateBanner'
import { GateExplainerModal } from '../gate/GateExplainerModal'
import { OutreachGate, type GateChrome } from '../gate/OutreachGate'
import { useOutreachGate } from '../gate/useOutreachGate'
import { useDraftGate } from '../gate/useDraftGate'
import {
  SMS_CUTOFF_COPY,
  formatSmsCutoffDate,
} from 'app/dashboard/campaign-verification/verificationCopy'
import { SmsCutoffNotice } from 'app/dashboard/shared/smsCutoff/SmsCutoffNotice'
import { useSmsCompliance } from 'app/dashboard/shared/smsCutoff/useSmsCompliance'
import {
  SERVE_SMS_PURPOSES,
  serveSmsPurposeNameSuggestion,
} from '../serveSmsPurposes'
import { EventDetailsStep } from '../EventDetailsStep'
import {
  EVENT_DETAILS_TITLE,
  isEventInvite,
  useEventDetails,
} from '../eventDetails'
import { SMS_PURPOSE_INTRO_BODY, SmsPurposeStep } from './SmsPurposeStep'
import {
  NAME_ONLY_COPY,
  SmsScheduleStep,
  TIME_OPTIONS,
} from './SmsScheduleStep'
import { ServeSmsScheduleStep } from './ServeSmsScheduleStep'
import { SmsComposeStep, type SmsRequiredPart } from './SmsComposeStep'
import { SmsReviewStep } from './SmsReviewStep'
import { PHONE_LIST_BUILD_POLL_LIMIT } from './smsPhoneListPollLimit'
import { MANAGED_PANEL_COPY } from 'app/dashboard/contacts/citizens-panel/managedPanelCopy'
import {
  addGreetingBack,
  addIdentificationBack,
  addOptOutBack,
  addPaidForByBack,
  composeManagedInvite,
  composeScript,
  MANAGED_INVITE_LOCKED_LINES,
  managedInviteBody,
  composeServeScript,
  paidForByLine,
  withOptOutUnderLastLine,
  ensureSmsIdentification,
  identificationIntro,
  provisionalCommitteeName,
  restoreSmsSystemRegions,
  openWithSmsIdentification,
  SMS_PURPOSES,
  type SmsFlowPurpose,
  unfilledBrackets,
  upgradeScriptFooter,
  profilePhotoFile,
} from './smsCompose.util'
import {
  createServeSms,
  useServeSmsIdentification,
  useServeSmsSend,
  type ServeSmsCreateFn,
} from './useServeSmsSend'

type StepId =
  | 'purpose'
  | 'details'
  | 'audience'
  | 'schedule'
  | 'compose'
  | 'review'
// The message before the date, on every entry.
const STEP_ORDER: StepId[] = [
  'purpose',
  'audience',
  'compose',
  'schedule',
  'review',
]

// Build mode (the candidate cannot send yet) has no date to pick, so the
// schedule step only names the campaign (design: the locked "when" step) and
// the draft is written off it. A free tier hands straight to the Pro gate
// from there; a Pro candidate who still has to verify continues to the
// "Review and verify" summary (design: flowReview's preClear branch).
const PRO_BUILD_STEP_ORDER: StepId[] = [
  'purpose',
  'audience',
  'compose',
  'schedule',
]
const VERIFY_BUILD_STEP_ORDER: StepId[] = [...PRO_BUILD_STEP_ORDER, 'review']

const STEP_TITLES: Record<StepId, string> = {
  purpose: 'What do you want to do?',
  details: EVENT_DETAILS_TITLE,
  audience: 'Who do you want to reach?',
  schedule: 'When do you want to send?',
  compose: 'What do you want to say?',
  review: 'Review & pay',
}

const PRICE_PER_MESSAGE = PRICE_PER_TEXT
// Mirrors gp-api MAX_AUDIENCE_RECIPIENTS: a larger list is refused at the
// checkout quote and by the phone-list build.
const SMS_MAX_RECIPIENTS = 200_000

// SMS texts cell phones, so both counts use the cell dimension:
// reachability.sms for a saved list, and a { hasCellPhone: true } overlay on
// the in-flow builder count. Count-only — the saved list stays general (see
// useOutreachAudience).
const SMS_COUNT_OVERLAY = { hasCellPhone: true }

const WIN_SMS_AUDIENCE_COPY: OutreachAudienceCopy = {
  pickerTitle: 'Who do you want to reach?',
  pickerBody:
    'Select a list or create a new one. Lists include all voters with a mobile number.',
  filtersTitle: 'Build a voter list',
  filtersBody: 'Pick filters to define who this campaign reaches.',
  nameTitle: 'Name your list',
  nameBody: 'You can rename it any time.',
  reachVerb: 'Message',
  reachNoun: 'voters',
  unitCostLabel: 'Each message costs',
}

// Serve's constituent-framed variant, the same spread-over-the-Win-object
// shape SERVE_PHONE_BANKING_AUDIENCE_COPY uses. Only the four voter- and
// candidacy-framed strings are overridden: pickerTitle, nameTitle, nameBody
// and the reach verb/unit-cost lines are channel framing, true on both
// surfaces, so they are shared as-is.
const SERVE_SMS_AUDIENCE_COPY: OutreachAudienceCopy = {
  ...WIN_SMS_AUDIENCE_COPY,
  pickerBody:
    'Select a list or create a new one. Lists include all constituents with a mobile number.',
  filtersTitle: 'Build a constituent list',
  filtersBody: 'Pick filters to define who this list reaches.',
  reachNoun: 'constituents',
}

// The fallback name part when no list is picked yet. Purpose-independent on
// Win — the auto-name is list-and-date driven there, and no Win SMS purpose
// carries a name suggestion.
const WIN_SMS_NAME_FALLBACK = 'Text campaign'

// Win picks a date AND an hourly slot inside a 48-hour floor and a 9am-8pm
// window, because Peerly enforces exactly that. Serve picks a date only and
// sends at a fixed 11am local: a human works a CSV, so an hour is a promise
// the product cannot keep. See docs/features/serve-sms.md, "Send timing".
type SmsFlowScheduleMode = 'winHourlySlots' | 'serveFixedMorning'

interface SmsFlowDraftInput {
  purpose: SmsFlowPurpose
  tone: SocialTone
  currentDraft?: string
  event?: OutreachEventDetails
}

// A caller-supplied surface parametrizes the purpose cards and their intro,
// the no-list name fallback, the audience-step copy, how the schedule step
// asks for a send time, what the system appends to the composed message, and
// which network the draft mutation hits. Everything else -- the steps, the
// shell, tone/Improve, the audience picker's reachabilityKey/countOverlay --
// is shared. Mirrors SocialFlowSurface and PhoneBankingFlowSurface.
export interface SmsFlowSurface {
  // Which product this surface belongs to. Read only for copy the
  // per-surface records below don't reach -- the shared steps' own strings.
  isServe: boolean
  purposes: { id: SmsFlowPurpose; label: string }[]
  purposeIntroBody: string
  nameSuggestion: (purpose: string) => string
  audienceCopy: OutreachAudienceCopy
  scheduleMode: SmsFlowScheduleMode
  // The system-owned regions around the typed body. Win appends paid-for-by
  // plus the opt-out line; Serve appends the opt-out line alone, because an
  // elected official has no candidate committee to disclose.
  composeMessage: (body: string, committeeName: string | null) => string
  // Standards rules that do not apply on this surface. checkSmsStandards is
  // the shared contract the server-side verdict also runs, and its
  // paid_for_by rule demands the phrase unconditionally -- correct for Win,
  // where a campaign cannot schedule an SMS without a registered committee.
  // A Serve org has no committee, so the rule could only ever fail and would
  // block Continue forever. Dropped here rather than loosened in contracts,
  // so Win's verdict keeps demanding it on both client and server.
  ignoredStandardsRules: readonly SmsStandardsRule[]
  endpoints: {
    draft: (input: SmsFlowDraftInput) => Promise<string>
    // Serve only. Win's create is `createOutreach` inside the flow's own
    // review-step effect and is not routed through the surface -- the two
    // send paths diverge completely below compose, so there is nothing for
    // a shared signature to buy. See useServeSmsSend.ts.
    create?: ServeSmsCreateFn
  }
}

// The default surface -- Win's campaign-scoped endpoint, unchanged from the
// flow's pre-parametrization behavior. The cast on the draft call is safe
// because this surface's `purposes` only ever contains SmsPurpose members,
// and the flow only ever drafts with a purpose drawn from them.
const WIN_SMS_SURFACE: SmsFlowSurface = {
  isServe: false,
  purposes: SMS_PURPOSES,
  purposeIntroBody: SMS_PURPOSE_INTRO_BODY,
  nameSuggestion: () => WIN_SMS_NAME_FALLBACK,
  audienceCopy: WIN_SMS_AUDIENCE_COPY,
  scheduleMode: 'winHourlySlots',
  composeMessage: composeScript,
  ignoredStandardsRules: [],
  endpoints: {
    draft: async (input) => {
      const { data } = await clientRequest(
        'POST /v1/outreach/sms/draft',
        input as SmsDraftRequest,
      )
      return data.draft
    },
  },
}

// Serve's org-scoped surface. Not yet mounted by any page -- the hub wiring
// ticket passes this as SmsFlow's `surface` prop on the Serve SMS card, and
// owns the rest of the Serve send path (there is no Peerly phone list, and
// create-and-pay needs its own purchase type).
export const SERVE_SMS_SURFACE: SmsFlowSurface = {
  isServe: true,
  purposes: SERVE_SMS_PURPOSES,
  purposeIntroBody:
    'This helps us draft the right message for your constituents.',
  nameSuggestion: serveSmsPurposeNameSuggestion,
  audienceCopy: SERVE_SMS_AUDIENCE_COPY,
  scheduleMode: 'serveFixedMorning',
  composeMessage: (body) => composeServeScript(body),
  ignoredStandardsRules: ['paid_for_by'],
  endpoints: {
    draft: async (input) => {
      const { data } = await clientRequest(
        'POST /v1/outreach/serve/sms/draft',
        input as ServeSmsDraftRequest,
      )
      return data.draft
    },
    create: createServeSms,
  },
}

interface SmsFlowProps {
  open: boolean
  tcrCompliance?: TcrCompliance
  onClose: () => void
  surface?: SmsFlowSurface
  // Fired after payment (or free redemption) completes server-side; the hub
  // refetches the outreach list there.
  onScheduled: () => Promise<void>
  // Seeds carried in by the hub's `?compose=text` deep link (campaign
  // tracker / manager task CTAs, Know Your Opponent's suggested message).
  // A tracker task's due date, persisted on the outreach row and forwarded
  // into the CAS Slack notification — the flow never derives it.
  campaignPlanDueDate?: string
  // The tracker task this flow was launched from (the hub's `?compose=` deep
  // link), carried onto the completion event so a completed task and the
  // outreach it produced are one funnel.
  tracker?: OutreachTrackerOrigin
  // Where the flow was opened from, for its stage events and the Pro gate.
  source: OutreachFlowSource
  // The agent surface that launched this send, for the Outreach events.
  launchSource?: OutreachLaunchSource
  // A message the candidate is meant to send as written (Know Your
  // Opponent). It opens the flow on `custom`, the one purpose that never
  // AI-drafts, so the seeded words are what they edit rather than something
  // a draft immediately overwrites.
  initialScript?: string
  // Opens past the purpose picker on this purpose, as a card that already
  // answered it (the Chief of Staff's civic panel card).
  initialPurpose?: SmsFlowPurpose
  // What an agent's proposal knows about the event it invites people to; the
  // details step opens on it.
  initialEvent?: ProposalEvent
  preselectedListId?: number
  // An audience a chat card counted but did not save: the audience step
  // opens on the list builder already filled in, and saves it when the
  // official confirms and names it.
  proposedAudience?: ProposedAudience
  // The chat card proposal this flow was opened from. Rides on the create
  // (Serve's whole link, Win's key), so the draft holds the card's key (a
  // paid one reads as sent and cannot be paid twice) and, on a priority, the
  // paid send puts its check out.
  proposalLink?: ProposalLink
  // The caller saved and picked the list (preselectedListId), as a chat card
  // does, so with a seeded message the flow lands on the message.
  audienceSettled?: boolean
  // Serve: the earlier text a report back card answers. Rides on the create,
  // which marks the send as a report back rather than a new ask.
  reportBackForOutreachId?: number
  // Serve: a priority's round 2, the number of texts its card proposed.
  // Rides on the create, which draws who gets them before the send date.
  roundTwoSize?: number
  // Win's create was refused while carrying the card's key, which is how a
  // card sent from another tab or an earlier session answers (409). The
  // card's surface decides whether that means it already went out.
  onProposalCreateFailed?: () => void
  // `?recommended=` off the voter data page: a recommendation not saved yet,
  // which the audience step saves on arrival (see useOutreachAudience).
  preselectedRecommendedVariant?: RecommendedListVariant
  // A saved draft the candidate is picking back up (milestone 2). The flow
  // opens on it instead of asking the questions it already answered.
  resumeDraft?: OutreachDetail | null
  // Fired once a draft is written or discarded, so the hub's history reflects
  // it; the same refetch a completed send does.
  onDraftSaved?: () => Promise<void>
  // The drawer's "Upgrade to Pro" already made the pitch, so that resume
  // opens the wizard on its first step; a tile or deep-link resume shows the
  // pause screen first.
  resumeStartsOnWizard?: boolean
  // The label of the button that resumed the draft, for the Pro gate.
  resumeCta?: string
  // Serve: the civic panel invite GoodParty sends in the official's name
  // (the managed panel), with `initialScript` as its body. Only the message
  // step: no audience, date, checkout or payment, and no Outreach row. Its
  // button approves the invite (POST /v1/contacts/civic-panel/managed) and
  // then calls `onSetUp`.
  managedInvite?: { place: string | null; onSetUp: () => void }
}

const successDate = (d: Date) =>
  d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

const successTime = (d: Date) =>
  d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

// A Win send is an instant in the campaign's zone, so it is read back in
// that zone; Serve's fixed-hour stamp is browser-local and takes no zone.
const sendDateLabel = (d: Date, timeZone?: string) =>
  timeZone ? formatInTimeZone(d, timeZone, 'EEE, MMM d, yyyy') : successDate(d)
const sendTimeLabel = (d: Date, timeZone?: string) =>
  timeZone ? formatInTimeZone(d, timeZone, 'h:mm a') : successTime(d)

// "visa" → "Visa" — Stripe reports card brands lowercase.
const cardBrandLabel = (brand: string) =>
  brand.charAt(0).toUpperCase() + brand.slice(1)

// Exported for its component test — the paid branch is unreachable through
// the flow in jsdom (CheckoutPayment mounts real Stripe elements).
export const SuccessScreen = ({
  contactCount,
  sendAt,
  timeZone,
  outreachId,
  paid,
  onDone,
}: {
  contactCount: number
  sendAt: Date | null
  timeZone?: string
  outreachId: number | null
  // Free-texts sends skip the receipt entirely — there is no charge, and
  // the endpoint 404s rows without a checkout session.
  paid: boolean
  onDone: () => void
}) => {
  const receiptQuery = useQuery({
    queryKey: ['outreach-receipt', outreachId],
    queryFn: async (): Promise<OutreachReceipt> => {
      const { data } = await clientRequest('GET /v1/outreach/:id/receipt', {
        id: String(outreachId),
      })
      return data
    },
    enabled: paid && outreachId !== null,
    retry: false,
  })
  const receipt = paid ? receiptQuery.data : undefined

  return (
    <div className="space-y-6 py-8 text-center">
      <div className="flex justify-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-primary-light">
          <CircleCheckIcon className="size-8 text-primary" />
        </span>
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold text-foreground">
          {paid ? 'Payment successful!' : 'Scheduled!'}
        </h2>
        <p className="text-muted-foreground">
          Your sms campaign will reach {contactCount.toLocaleString()}{' '}
          recipients
          {sendAt
            ? ` starting ${sendDateLabel(sendAt, timeZone)} at ${sendTimeLabel(sendAt, timeZone)}.`
            : ' soon.'}
        </p>
      </div>
      {receipt && (
        <Card className="gap-0 p-0 text-left">
          <div className="flex items-center justify-between px-4 py-4">
            <p className="font-medium text-foreground">Receipt</p>
            <p className="text-sm text-muted-foreground">
              {new Date().toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </p>
          </div>
          <div className="border-t border-border px-4 py-4">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">
                  SMS campaign, {contactCount.toLocaleString()} recipients
                </dt>
                <dd className="text-foreground">
                  ${receipt.amount.toFixed(2)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Cost per outreach</dt>
                <dd className="text-foreground">
                  ${PRICE_PER_MESSAGE.toFixed(3)}
                </dd>
              </div>
              {receipt.cardBrand && receipt.cardLast4 && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Card</dt>
                  <dd className="text-foreground">
                    {cardBrandLabel(receipt.cardBrand)} •••• {receipt.cardLast4}
                  </dd>
                </div>
              )}
            </dl>
          </div>
          <div className="flex items-center justify-between border-t border-border px-4 py-4">
            <span className="font-semibold text-foreground">Charged today</span>
            <span className="font-semibold text-foreground">
              ${receipt.amount.toFixed(2)}
            </span>
          </div>
        </Card>
      )}
      {receipt?.receiptUrl && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => {
            window.open(receipt.receiptUrl ?? '', '_blank', 'noopener')
          }}
        >
          <DownloadIcon className="size-4" />
          Download receipt
        </Button>
      )}
      <Button size="large" className="w-full" onClick={onDone}>
        Done
      </Button>
    </div>
  )
}

// Flow state is flat client state owned here (phase 1 shell convention):
// nothing persists until the pay step's draft-first create, and reopening
// starts fresh.
export const SmsFlow = ({
  open,
  onClose,
  onScheduled,
  tcrCompliance,
  surface = WIN_SMS_SURFACE,
  campaignPlanDueDate,
  tracker,
  initialEvent,
  source,
  launchSource,
  initialScript,
  initialPurpose,
  proposedAudience,
  proposalLink,
  audienceSettled = false,
  reportBackForOutreachId,
  roundTwoSize,
  onProposalCreateFailed,
  preselectedListId,
  preselectedRecommendedVariant,
  resumeDraft = null,
  onDraftSaved,
  resumeStartsOnWizard = false,
  resumeCta,
  managedInvite,
}: SmsFlowProps) => {
  const managed = managedInvite !== undefined && surface.isServe
  const [managedConsent, setManagedConsent] = useState(false)
  const [managedError, setManagedError] = useState(false)
  const managedApprove = useMutation({
    mutationFn: async (inviteMessage: string) => {
      const { data } = await clientRequest(
        'POST /v1/contacts/civic-panel/managed',
        { inviteMessage, consentVersion: MANAGED_CIVIC_PANEL_CONSENT_VERSION },
      )
      return data
    },
  })
  // What the official used on the managed invite, for its Submitted event.
  const managedUsedAiRef = useRef(false)
  const managedUsedDictationRef = useRef(false)
  const [campaign] = useCampaign()
  const [user] = useUser()
  const gate = useOutreachGate('sms')
  const { smsCutoffDate } = useSmsCompliance()
  const lockedAtOpen = useLockedAtOpen(open, gate)
  // gp-api reads the picked wall-clock window in the campaign state's zone
  // (Peerly `requested_timezone`), so the step captions that zone rather
  // than the browser's.
  const timeZone = resolveCampaignTimeZone(campaign?.details?.state)

  const [stepId, setStepId] = useState<StepId>('purpose')
  const [purpose, setPurpose] = useState<SmsFlowPurpose | null>(null)
  const eventDetails = useEventDetails({
    enabled: open && isEventInvite(purpose),
    isServe: surface.isServe,
    proposed: initialEvent,
  })
  const { reset: resetEventDetails } = eventDetails
  // The details the current body was written from: changing them on the way
  // back through the details step makes that body stale.
  const confirmedEventRef = useRef<string | null>(null)
  const [tone, setTone] = useState<SocialTone>('warm')
  // The whole message as sent. The greeting, disclaimer and opt-out line
  // live in it as editable text rather than around it as separate regions.
  const [message, setMessage] = useState('')
  // A Serve text from a priority card ends on the residents' calls to
  // action together: the reply instruction the assistant wrote, then the
  // opt-out directly under it. Only the managed invite asks people to join
  // the civic panel, and it composes its own lines.
  const optOutUnderLastLine =
    surface.isServe && !managed && proposalLink?.priorityId !== undefined
  // A report back's audience is one earlier send, which only its card can
  // name, so the picker never offers it.
  // The panel invite only goes out in the managed panel's waves.
  const purposes = surface.purposes.filter(
    ({ id }) =>
      id !== REPORT_BACK_PURPOSE && id !== BUILD_CITIZENS_PANEL_PURPOSE,
  )
  // Whether the words are the candidate's (typed, seeded or polished) rather
  // than an untouched fresh draft. Picks the one AI action: Regenerate, or
  // Improve with AI.
  const [ownWords, setOwnWords] = useState(false)
  // The candidate's words from just before the last AI change replaced
  // them. Typing clears it: going back would throw the typing away.
  const [undoText, setUndoText] = useState<string | null>(null)
  const [toneDrafts, setToneDrafts] = useState<
    Partial<Record<SocialTone, string>>
  >({})

  const [phoneListToken, setPhoneListToken] = useState<string | null>(null)
  // The build-status poll's handle — set from the same POST response as
  // `phoneListToken`, but the poll keys off this rather than the token
  // (gp-api resolves it before Peerly necessarily has anything to report).
  const [phoneListBuildId, setPhoneListBuildId] = useState<string | null>(null)
  const [phoneListCreating, setPhoneListCreating] = useState(false)
  const [phoneListError, setPhoneListError] = useState(false)
  const [stopPolling, setStopPolling] = useState(false)
  // A priority text's follow-up, as the create settled it.
  const [followUp, setFollowUp] = useState<
    ServeSmsCreateResponse['followUp'] | null
  >(null)
  const [phoneList, setPhoneList] = useState<PhoneListStatusResponse | null>(
    null,
  )
  // A build the poll resolved to `failed` — a review-step-level state,
  // distinct from `phoneListError` (which blocks Continue a step earlier,
  // before a build even starts polling). Carries its own retry rather than
  // sharing `phoneListError`'s because by review time there's a phone list
  // build to re-request, not a list create to re-run.
  const [phoneListBuildFailed, setPhoneListBuildFailed] = useState(false)

  const [name, setName] = useState('')
  // What the auto-name last wrote, and the date it ended with. Cleared with
  // the name and date on open, so a reopened or resumed flow never rewrites
  // a name off a date picked in an earlier session.
  const lastAutoName = useRef('')
  const lastDatePart = useRef('')
  const [nameEdited, setNameEdited] = useState(false)
  const [date, setDate] = useState<Date | undefined>(undefined)
  const [timeSlot, setTimeSlot] = useState('10')
  const [customTime, setCustomTime] = useState('10:00')

  const [image, setImage] = useState<File | null>(null)
  // Bumped by the open reset, which clears the image, so the profile photo
  // prefill below runs again for each fresh open.
  const [imageResetCount, setImageResetCount] = useState(0)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  // Presses of the message step's Continue while something was missing. The
  // step shows what is missing only after the first, and moves to it on each.
  const [composeContinueAttempts, setComposeContinueAttempts] = useState(0)

  const [draftOutreachId, setDraftOutreachId] = useState<number | null>(null)
  const [draftCreateError, setDraftCreateError] = useState(false)
  // The server's own reason when it refused the draft, so the review step can
  // say why instead of only "try again" (ENG-11413).
  const [draftCreateErrorMessage, setDraftCreateErrorMessage] = useState<
    string | null
  >(null)
  const isDraftCreatingRef = useRef(false)
  // Bumped whenever the current draft is discarded (Back off review): an
  // in-flight create started before the bump must not resurrect its id —
  // checkout would then charge for the pre-edit message and date.
  const draftGenerationRef = useRef(0)
  const [scheduled, setScheduled] = useState(false)
  const [paidSend, setPaidSend] = useState(false)

  const draftRequestRef = useRef(0)
  // The body of a seed carried in from outside the flow, held until it has
  // been checked for the sender's identification. Cleared by the check, or
  // by the first keystroke, so hand-typed text is never rewritten.
  const seedUncheckedRef = useRef<string | null>(null)

  // Every saved-draft and gate concern — the row, the resume switch, the
  // gate/explainer visibility, and the origin that says what finishing the
  // gate means — lives in the shared hook RobocallFlow uses too. Only the
  // payload and the step ids below are this channel's.
  const draftGate = useDraftGate({
    channel: 'sms',
    gate,
    open,
    resumeDraft,
    resumeCta,
    createDraft: () => createDraftRow(),
    goToResumeStep: () => setStepId('schedule'),
    onDraftSaved: () => handleDraftSaved(),
    // A gated candidate's campaign is created by the draft save, not by the
    // pending_payment row the review step writes — which they never reach.
    onCampaignCreated: (draft) =>
      trackEvent(
        EVENTS.Dashboard.VoterContact.CampaignCreated,
        outreachEventProps({
          channel: 'text',
          isServe: surface.isServe,
          campaignName: name.trim(),
          recipientCount: audience.reachableCount ?? 0,
          outreachCampaignId: draft.id,
          ...(audience.selectedListId !== null
            ? { listId: audience.selectedListId }
            : {}),
          audienceSource: audience.selectedRecommendation
            ? 'recommended'
            : 'savedList',
          ...(tracker ? { tracker } : {}),
          ...(launchSource ? { launchSource } : {}),
          ...(purpose ? { purpose } : {}),
        }),
      ),
    onClose,
  })
  const { savedDraft, resumed, gateOpen, explainerOpen } = draftGate
  // While a gate screen is up the sheet header is the gate's (design:
  // renderSgModal's "Upgrade to Pro" overline and its own stepper), not the
  // flow's channel badge and step count.
  const [gateChrome, setGateChrome] = useState<GateChrome | null>(null)
  const showGateChrome = gateOpen && gateChrome !== null

  // Everything new here hangs off one of these two: with no requirement and
  // no resumed row the flow is byte-identical to the pre-gate one.
  const buildMode = gate.requirement !== null && !resumed
  const baseStepOrder = !buildMode
    ? STEP_ORDER
    : gate.requirement === 'pro'
      ? PRO_BUILD_STEP_ORDER
      : VERIFY_BUILD_STEP_ORDER
  // A seeded message opens past the purpose picker on `custom`: the words
  // are already chosen, so asking what the candidate wants to do and then
  // drafting over them would throw the seed away. A carried-in
  // recommendation opens past it too, on the purpose its intent maps onto:
  // the candidate answered that question by picking the card.
  const carriedPurpose =
    initialPurpose ??
    (preselectedRecommendedVariant
      ? purposeForRecommendedVariant(preselectedRecommendedVariant)
      : null)
  const landing = outreachLandingStep({
    purposeSettled: carriedPurpose !== null,
    audienceSettled: audienceSettled && preselectedListId !== undefined,
    messageSettled: Boolean(initialScript),
  })
  const opensOnMessage = landing === 'message' && !resumeDraft
  const stepOrder: StepId[] = managed
    ? ['compose']
    : isEventInvite(purpose)
      ? baseStepOrder.flatMap((id) =>
          id === 'purpose' ? ['purpose', 'details'] : [id],
        )
      : baseStepOrder

  // Reference equality against the Win singleton, not a purpose check:
  // recommended lists are Win-only (the endpoint 400s an eo- org outright),
  // and Serve's purpose vocabulary reuses three of the same slugs
  // (introduce_myself, event_invite, custom) for an unrelated, non-electoral
  // meaning, so the purpose string alone can't tell the two apart. Same
  // guard as PhoneBankingFlow.
  const isWinSms = surface === WIN_SMS_SURFACE
  const recommendedListIntent =
    isWinSms && purpose ? intentForOutreachPurpose(purpose as SmsPurpose) : null

  // A resumed row already names its audience; the picker selects it the same
  // way a deep link's does, which is also what gives the resume its reach
  // count and its Peerly phone list.
  const resumedListId = resumed
    ? (savedDraft?.voterFileFilterId ?? undefined)
    : undefined

  const audience = useOutreachAudience({
    open,
    active: stepId === 'audience',
    reachabilityKey: 'sms',
    countOverlay: SMS_COUNT_OVERLAY,
    recommendedListIntent,
    preselectedListId: resumedListId ?? preselectedListId,
    preselectedRecommendedVariant,
    ...(proposedAudience && !resumeDraft && { proposedAudience }),
  })
  const { reset: resetAudience } = audience
  const selectedList = audience.selectedList
  const reachableCount = audience.reachableCount
  const reachableOverCap =
    reachableCount !== null && reachableCount > SMS_MAX_RECIPIENTS
  const builderOverCap =
    audience.mode === 'filters' &&
    audience.builderCount !== undefined &&
    audience.builderCount > SMS_MAX_RECIPIENTS
  const composeMessage = (body: string, committee: string | null) =>
    surface.composeMessage(body, committee)

  // Win p2p SMS hold billing: the pay step can render on the pre-pay estimate
  // before the phone-list build is ready (gp-api runs the matching rollout
  // behind the managed Amplitude flag `win_sms_hold_billing`, evaluated
  // per-user at entry). Read with exposure tracking only on the Win surface —
  // SmsFlow is shared with Serve, which is not in this experiment.
  const { enabled: winSmsHoldEnabled } = useWinSmsHoldFlag(isWinSms)
  const holdBillingActive = isWinSms && winSmsHoldEnabled
  // Mirrors the review step's isFree: a send the free-texts offer fully covers
  // reads/takes the free path. Pay-before-ready is a paid flow only — a free
  // pre-build send places no hold and gp-api refuses it (it must wait for the
  // list), so a free send keeps the unchanged spinner-until-ready sequence.
  const isFreeSend =
    Boolean(campaign?.hasFreeTextsOffer) &&
    (phoneList?.leadsLoaded ?? reachableCount ?? 0) <= FREE_TEXTS_OFFER.COUNT
  // A list create succeeded enough to proceed. The sync path returns a token;
  // an async build (gp-api behind the `win_sms_hold_billing` flag) returns a
  // null token with only the buildId, which is NOT a failure — the checkout
  // then bills/links the hold off the buildId instead. Trust the SERVER's own
  // response here, never this client's `holdBillingActive` belief: gp-api and
  // the browser evaluate the SAME managed flag independently (one via
  // FeaturesService per-request, the other via the Amplitude JS SDK on its own
  // async schedule), so a null token can legitimately arrive before this
  // client's own flag read has resolved. A null token is self-describing proof
  // the server ran the async path regardless of why; gating acceptance on a
  // local flag belief that can lag or disagree would reject a perfectly good
  // response as a false "could not prepare this audience" error.
  const phoneListResultUsable = (
    result: PhoneListResult,
  ): result is { ok: true } & PhoneListResponse => result.ok && !!result.buildId

  // A build-ready list always has its numeric phoneListId; before that, only a
  // paid hold-billing send may pay (on the estimate), and only once the list
  // create returned its build handle and the build has not failed. buildId is
  // set from the same response as the token (both paths return it), so it
  // covers the sync token case and the async token-null case alike.
  const payBeforeReady =
    holdBillingActive &&
    !isFreeSend &&
    !phoneList?.phoneListId &&
    !!phoneListBuildId &&
    !phoneListBuildFailed

  const draftMutation = useMutation({
    mutationFn: (input: SmsFlowDraftInput) => surface.endpoints.draft(input),
  })
  const { reset: resetDraftMutation } = draftMutation

  useEffect(() => {
    if (!open) return
    draftRequestRef.current += 1
    // A resumed draft answered purpose, audience and compose when it was
    // built, so it opens on the one thing still missing.
    // An event invite still asks its details first, even with the audience
    // settled: the draft is written from them.
    setManagedConsent(false)
    setManagedError(false)
    if (managed) {
      draftRequestRef.current += 1
      setStepId('compose')
      setPurpose(BUILD_CITIZENS_PANEL_PURPOSE)
      setTone('warm')
      setMessage(initialScript ?? '')
      seedUncheckedRef.current = null
      setOwnWords(true)
      setUndoText(null)
      setToneDrafts({})
      setComposeContinueAttempts(0)
      resetDraftMutation()
      return
    }
    setStepId(
      resumeDraft
        ? 'schedule'
        : landing === 'purpose'
          ? 'purpose'
          : !initialScript && isEventInvite(carriedPurpose)
            ? 'details'
            : landing === 'message'
              ? 'compose'
              : 'audience',
    )
    // A card that names its purpose as well as its words (a report back)
    // keeps that purpose, so the flow treats the send as the purpose's own.
    setPurpose(initialPurpose ?? (initialScript ? 'custom' : carriedPurpose))
    resetEventDetails()
    confirmedEventRef.current = null
    setTone('warm')
    const seeded = initialScript
      ? surface.composeMessage(initialScript, null)
      : ''
    loadMessage(seeded)
    seedUncheckedRef.current = initialScript || null
    setOwnWords(Boolean(initialScript))
    setUndoText(null)
    setToneDrafts({})
    resetAudience()
    setPhoneListToken(null)
    setPhoneListBuildId(null)
    setPhoneListCreating(false)
    setPhoneListError(false)
    setStopPolling(false)
    setPhoneList(null)
    setPhoneListBuildFailed(false)
    setName(resumeDraft?.name ?? '')
    setNameEdited(Boolean(resumeDraft?.name))
    lastAutoName.current = ''
    lastDatePart.current = ''
    setDate(undefined)
    setTimeSlot('10')
    setCustomTime('10:00')
    setImage(null)
    setImageResetCount((count) => count + 1)
    setImageError(null)
    setComposeContinueAttempts(0)
    setDraftOutreachId(null)
    setFollowUp(null)
    setDraftCreateError(false)
    setScheduled(false)
    setPaidSend(false)
    resetDraftMutation()
  }, [
    open,
    resetDraftMutation,
    resetAudience,
    resetEventDetails,
    initialScript,
    initialPurpose,
    preselectedRecommendedVariant,
    resumeDraft,
    surface,
    landing,
    carriedPurpose,
    managed,
  ])

  // A fresh text starts with the sender's profile photo attached. Win reads
  // the campaign owner's, since a Campaign Manager composing is not the
  // candidate; Serve's sender is the session user. A resume keeps its saved
  // image, and a photo the candidate removed or replaced is never put back.
  const profilePhotoUrl = surface.isServe
    ? (user?.avatar ?? null)
    : (campaign?.ownerAvatar ?? null)
  const profilePhotoAppliedRef = useRef<number | null>(null)
  useEffect(() => {
    if (
      !open ||
      resumeDraft ||
      !profilePhotoUrl ||
      profilePhotoAppliedRef.current === imageResetCount
    ) {
      return
    }
    profilePhotoAppliedRef.current = imageResetCount
    let settled = false
    void profilePhotoFile(profilePhotoUrl).then((file) => {
      if (settled) return
      settled = true
      if (file) setImage((current) => current ?? file)
    })
    return () => {
      if (!settled) profilePhotoAppliedRef.current = null
      settled = true
    }
  }, [open, resumeDraft, profilePhotoUrl, imageResetCount])

  // Object URL lifecycle for the image preview.
  useEffect(() => {
    if (!image) {
      setImagePreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(image)
    setImagePreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [image])

  // The message identifies the CANDIDATE — the campaign owner, not whoever
  // is composing (a Campaign Manager's own name would fail the server-side
  // standards check at scheduling). Fall back to the session user only while
  // the campaign hasn't resolved; a loaded campaign whose owner has no name
  // (ownerName null) stays '', matching what the server grounds drafts in.
  const candidateFullName =
    campaign?.ownerName ??
    (campaign == null
      ? `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim()
      : '')
  // Serve's office comes from the org's position name, not from a campaign
  // row it does not have; the hook owns that derivation.
  const serveIntroFor = useServeSmsIdentification(candidateFullName)
  // Win's office prefers positionName (the org's elections-DB position,
  // already on campaigns/mine) over details.normalizedOffice, which is empty
  // for org-era onboardings and read "candidate for local office" — the same
  // chain gp-api's own draft grounding resolves (resolveOffice). `||`, not
  // `??`: resolvePositionContext can pass an empty customPositionName
  // through, and it must not mask a populated normalizedOffice.
  const introFor = (t: SocialTone) =>
    surface.isServe
      ? serveIntroFor(t)
      : identificationIntro(
          t,
          candidateFullName,
          campaign?.positionName || campaign?.details?.normalizedOffice || '',
        )
  const identificationNames = [
    candidateFullName,
    tcrCompliance?.candidateName,
  ].filter((name): name is string => !!name)
  // Every body the flow sets that the official did not type goes through
  // this, so the compose step never opens on a candidate_name failure.
  const identificationFor = (t: SocialTone) => ({
    intro: introFor(t),
    senderName: candidateFullName,
    candidateNames: identificationNames,
  })
  const withIdentification = (text: string, t: SocialTone): string =>
    ensureSmsIdentification(text, identificationFor(t))
  // The seed lands in the open effect, before the sender's name may be
  // known: Win waits on the campaign (a Campaign Manager's own session name
  // is not the candidate's), Serve on the user, and both on a name to check
  // against, since an empty list would wave the seed through unchecked.
  const identificationReady =
    (surface.isServe ? Boolean(user) : campaign != null) &&
    identificationNames.length > 0
  useEffect(() => {
    const seed = seedUncheckedRef.current
    if (!open || seed === null || !identificationReady) return
    seedUncheckedRef.current = null
    // Repaired as a body, then composed: the identification follows the
    // greeting. Composed without a committee; the footer effect below adds
    // the line the message should name.
    const repaired = surface.composeMessage(
      withIdentification(seed, 'warm'),
      null,
    )
    loadMessage(repaired)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per seed, when the name resolves
  }, [open, initialScript, identificationReady])
  // Paid-for-by is a campaign-finance disclaimer naming a candidate
  // committee, which a Serve org does not have. Nulled at the source rather
  // than only inside composeMessage so the submitted script, the preview
  // bubble and checkSmsStandards cannot disagree about whether there is a
  // committee.
  const committeeName = surface.isServe
    ? null
    : (tcrCompliance?.committeeName ?? null)
  // Until verification records the committee, the message names a
  // provisional one, so the "Paid for by" line is always there to see. It is
  // swapped for the real committee the moment one exists.
  const provisionalCommittee = surface.isServe
    ? null
    : provisionalCommitteeName(candidateFullName)
  const footerCommittee = committeeName ?? provisionalCommittee
  const upgradeFooter = (script: string) =>
    upgradeScriptFooter(script, footerCommittee)
  // A resumed row carries the script exactly as it was saved (intro, body and
  // system footer already joined), so it must not be composed a second time.
  // Only the system footer is upgraded: a draft saved before verification has
  // no paid-for-by line, and scheduling's server-side compliance check will
  // demand it against the committee that exists by resume time.
  const composedMessage = managed
    ? composeManagedInvite(message)
    : resumed && savedDraft?.script
      ? upgradeFooter(savedDraft.script)
      : message
  const composedLength = composedMessage.length
  // Every message the flow writes (a draft, a seed, an undo) names the
  // committee it should. A message the candidate edits is left as they wrote
  // it: a disclaimer they deleted is theirs to add back, not ours to restore
  // under them.
  const loadMessage = (next: string) => {
    const upgraded = upgradeFooter(next)
    setMessage(
      optOutUnderLastLine ? withOptOutUnderLastLine(upgraded) : upgraded,
    )
  }
  // The committee resolves after the flow opens, so a message composed
  // before it has the opt-out line alone. Same upgrade a resumed draft gets.
  useEffect(() => {
    setMessage((current) => upgradeFooter(current))
    // upgradeFooter is rebuilt each render from footerCommittee.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [footerCommittee])
  // The message with nothing written between its required parts.
  const emptyMessage = composeMessage('', footerCommittee)
  const hasWrittenBody = managed
    ? message.trim() !== ''
    : message.replace(/\s+/g, '') !== '' &&
      message.replace(/\s+/g, '') !== emptyMessage.replace(/\s+/g, '')
  const rawStandards = checkSmsStandards(composedMessage, {
    candidateNames: identificationNames,
    committeeName,
  })
  // Win ignores nothing once a committee exists, so this is the raw verdict
  // there. Without one (build mode -- the campaign is not verified yet) the
  // line names a provisional committee the server would not accept, so the
  // rule is dropped here; the footer upgrade above swaps in the real
  // committee once verification records it, before anything can be sent.
  const ignoredStandardsRules: readonly SmsStandardsRule[] =
    !surface.isServe && committeeName === null
      ? [...surface.ignoredStandardsRules, 'paid_for_by']
      : surface.ignoredStandardsRules
  const standardsFailures = rawStandards.failures.filter(
    (rule) => !ignoredStandardsRules.includes(rule),
  )
  const standards = {
    passed: standardsFailures.length === 0,
    failures: standardsFailures,
  }
  const bracketsToFill = unfilledBrackets(message)

  // Only fully verified campaigns can reach this flow (the 2026-08-28 full
  // gate), so the send floor is the hard 48-hour scheduling window.
  const earliestSend = useMemo(
    () => Date.now() + 48 * 60 * 60 * 1000,

    // each open, like the fresh-state reset
    [open],
  )

  // Serve has no slot to resolve: its step stamps the fixed 11am send hour
  // onto the day it hands back, so the picked date IS the scheduled moment.
  const fixedMorningSchedule = surface.scheduleMode === 'serveFixedMorning'

  // The picked wall-clock time is read in the campaign's zone, not the
  // browser's: gp-api hands Peerly that same zone, so a candidate scheduling
  // from another timezone still gets the hour they picked where their voters
  // are. Serve stamps its fixed hour onto the day itself (browser-local).
  const scheduledAt = useMemo(() => {
    if (!date) return null
    if (fixedMorningSchedule) return date
    const slot = TIME_OPTIONS.find((t) => t.id === timeSlot)
    const timeStr = timeSlot === 'custom' ? customTime : slot?.time
    if (!timeStr || !/^\d{2}:\d{2}$/.test(timeStr)) return null
    return combineScheduledAt(date, timeStr, timeZone)
  }, [date, timeSlot, customTime, fixedMorningSchedule, timeZone])

  // Both windows are Peerly's, so both are Win-only. Serve's calendar
  // disables every date it will not accept (2 business days out, 30-day
  // ceiling, weekends), which leaves no invalid selection to explain.
  const violates48h =
    !fixedMorningSchedule && scheduledAt
      ? scheduledAt.getTime() < earliestSend
      : false
  // 8 PM cap, not the 9 PM compliance cutoff: the chosen time opens Peerly's
  // send window and the window always closes at 9 PM, so a later start
  // would leave a zero-width window (server clamps too).
  const scheduledHour =
    scheduledAt && Number(formatInTimeZone(scheduledAt, timeZone, 'HH'))
  const scheduledMinute =
    scheduledAt && Number(formatInTimeZone(scheduledAt, timeZone, 'mm'))
  const outsideWindow =
    !fixedMorningSchedule && scheduledHour !== null && scheduledMinute !== null
      ? scheduledHour < 9 ||
        scheduledHour > 20 ||
        (scheduledHour === 20 && scheduledMinute > 0)
      : false

  // Serve's entire send sequence: no Peerly phone list, one org-scoped
  // create, SERVE_TEXT at checkout. Mounted unconditionally (rules of
  // hooks) and inert on Win -- every callback below is reached only through
  // an `if (surface.isServe)` guard, and its create effect returns at its
  // own first line. See useServeSmsSend.ts for why the Win lines under each
  // guard are left exactly where they are.
  const serveSend = useServeSmsSend({
    isServe: surface.isServe,
    open,
    stepId,
    scheduled,
    name,
    composedMessage,
    scheduledAt,
    image,
    draftOutreachId,
    audience,
    tracker,
    purpose,
    ...(proposalLink && !resumeDraft && { proposalLink }),
    ...(reportBackForOutreachId !== undefined &&
      !resumeDraft && { reportBackForOutreachId }),
    ...(roundTwoSize !== undefined && !resumeDraft && { roundTwoSize }),
    launchSource,
    create: surface.endpoints.create,
    setStepId,
    setDraftOutreachId,
    setDraftCreateError,
    setRecipientCounts: setPhoneList,
    setFollowUp,
    isDraftCreatingRef,
    draftGenerationRef,
  })

  // Auto-name from list + date until the user edits the name. An edited
  // name that still ends with the date we added keeps following the picker,
  // so the name never names a different day than the one picked.
  useEffect(() => {
    // Purpose-independent on Win (the surface ignores the argument and
    // returns the same fallback), purpose-keyed on Serve.
    const listPart = selectedList?.name ?? surface.nameSuggestion(purpose ?? '')
    const datePart = date
      ? `, ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      : ''
    const previousDatePart = lastDatePart.current
    lastDatePart.current = datePart
    if (nameEdited) {
      if (
        datePart !== previousDatePart &&
        previousDatePart !== '' &&
        name.endsWith(previousDatePart)
      ) {
        setName(`${name.slice(0, -previousDatePart.length)}${datePart}`)
      }
      return
    }
    const auto = `${listPart}${datePart}`
    if (name === '' || name === lastAutoName.current) {
      setName(auto)
      lastAutoName.current = auto
    }
  }, [selectedList, date, name, nameEdited, surface, purpose])

  // An Improve reply keeps the greeting and footer exactly as the system
  // wrote them, because gp-api masks them. One that does not (a gp-api from
  // before masking, mid-deploy) has them composed back around its body, so a
  // polish can never send without the disclaimer or opt-out.
  // Any civic panel line in the reply is dropped: no text the flow sends
  // carries one.
  const keepSystemRegions = (reply: string): string => {
    const [greeting = '', footer = ''] = surface
      .composeMessage('', footerCommittee)
      .split('\n\n')
    return restoreSmsSystemRegions(reply, {
      greeting,
      footer,
      token: mergeTagToken('first_name', surface.isServe ? 'serve' : 'peerly'),
    })
  }

  const requestDraft = (
    nextPurpose: SmsFlowPurpose | null,
    nextTone: SocialTone,
    priorMessage: string,
    priorOwnWords: boolean,
    currentDraft?: string,
  ) => {
    if (!nextPurpose) return
    if (nextPurpose === 'custom' && currentDraft === undefined) return
    // The polish endpoint takes a message within the limit. Every path to it
    // (the AI button, a tone pill, Try again) stops here when it is over, and
    // the over-limit note already says to shorten it.
    if (
      currentDraft !== undefined &&
      currentDraft.length > SMS_COMPOSED_MAX_LENGTH
    ) {
      return
    }
    const requestId = ++draftRequestRef.current
    const event = isEventInvite(nextPurpose) ? eventDetails.event : null
    draftMutation.mutate(
      {
        purpose: nextPurpose,
        tone: nextTone,
        ...(currentDraft === undefined ? {} : { currentDraft }),
        ...(event ? { event } : {}),
      },
      {
        onSuccess: (generated) => {
          if (requestId !== draftRequestRef.current) return
          setUndoText(priorOwnWords ? priorMessage : null)
          // The model writes the body only, so a fresh draft is composed
          // around it here: greeting, the identification (the body's
          // editable first sentence, replacing any the model wrote),
          // disclaimer and opt-out. Improve sends the whole message and gets
          // the whole message back as is: gp-api locks the name, so a reply
          // cannot drop it, and repairing the identification here would put
          // an intro in front of the greeting.
          const full = managed
            ? managedInviteBody(generated)
            : currentDraft === undefined
              ? composeMessage(
                  openWithSmsIdentification(
                    generated,
                    identificationFor(nextTone),
                  ),
                  footerCommittee,
                )
              : keepSystemRegions(generated)
          loadMessage(full)
          setOwnWords(currentDraft !== undefined)
          // Only fresh drafts are remembered per tone: a polish is of the
          // candidate's words, which a tone switch must not swap away.
          if (currentDraft === undefined) {
            setToneDrafts((prev) => ({ ...prev, [nextTone]: full }))
          }
        },
        // A first draft that fails leaves nothing to write into, so the
        // field gets the message's required parts and the candidate writes
        // between them, as on the custom purpose.
        onError: () => {
          if (requestId !== draftRequestRef.current) return
          if (priorMessage.trim().length > 0) return
          loadMessage(composeMessage('', footerCommittee))
        },
      },
    )
  }

  const handleSelectPurpose = (selected: SmsFlowPurpose) => {
    setPurpose(selected)
    setTone('warm')
    setUndoText(null)
    // A custom message starts as its required parts, written between.
    const start =
      selected === 'custom' ? composeMessage('', footerCommittee) : ''
    loadMessage(start)
    setOwnWords(selected === 'custom')
    setToneDrafts({})
    resetDraftMutation()
    confirmedEventRef.current = null
    setStepId(isEventInvite(selected) ? 'details' : 'audience')
  }

  const handleEventDetailsContinue = () => {
    const confirmed = JSON.stringify(eventDetails.event)
    if (confirmedEventRef.current !== confirmed) {
      confirmedEventRef.current = confirmed
      draftRequestRef.current += 1
      setMessage('')
      setOwnWords(false)
      setToneDrafts({})
      setUndoText(null)
      resetDraftMutation()
    }
    setStepId('audience')
  }

  const handleToneChange = (nextTone: SocialTone) => {
    if (nextTone === tone) return
    // The candidate's own words are polished in the new tone, never
    // replaced by a fresh draft in it.
    if (ownWords) {
      setTone(nextTone)
      if (hasWrittenBody) {
        requestDraft(purpose, nextTone, message, ownWords, message)
      }
      return
    }
    if (!purpose || purpose === 'custom') {
      setTone(nextTone)
      return
    }
    // A blank message (first generation still in flight) must neither be
    // cached for the outgoing tone nor treated as a memory hit for the
    // incoming one — restoring '' would blank the editor and skip the fetch.
    const remembered = toneDrafts[nextTone]
    if (message.trim().length > 0) {
      setToneDrafts((prev) => ({ ...prev, [tone]: message }))
    }
    setTone(nextTone)
    if (remembered !== undefined && remembered.trim().length > 0) {
      draftRequestRef.current += 1
      resetDraftMutation()
      // Not re-checked: a generated entry was identified when it arrived,
      // and any other entry is the candidate's own typing.
      loadMessage(remembered)
      // Undo belonged to the words just swapped out, not to this draft.
      setUndoText(null)
      return
    }
    requestDraft(purpose, nextTone, message, ownWords)
  }

  const handleMessageChange = (value: string) => {
    seedUncheckedRef.current = null
    setMessage(value)
    setOwnWords(true)
    setUndoText(null)
    // An edit wins over a reply still in flight, which would otherwise land
    // on top of it. Dropping the call also clears a failed one's error.
    draftRequestRef.current += 1
    if (draftMutation.isPending || draftMutation.isError) resetDraftMutation()
  }

  const aiAction = ownWords ? 'improve' : 'regenerate'
  const handleAiAction = () => {
    if (managed) managedUsedAiRef.current = true
    if (aiAction === 'regenerate') {
      requestDraft(purpose, tone, message, ownWords)
      return
    }
    if (!hasWrittenBody) return
    // The invite's locked lines go along, so the rewrite reads them, and
    // come off again with the reply.
    requestDraft(
      purpose,
      tone,
      message,
      ownWords,
      managed ? composedMessage : message,
    )
  }

  const handleManagedSetUp = () => {
    const ready =
      hasWrittenBody &&
      standards.passed &&
      bracketsToFill.length === 0 &&
      composedLength <= SMS_COMPOSED_MAX_LENGTH
    if (!ready) {
      setComposeContinueAttempts((n) => n + 1)
      return
    }
    setManagedError(false)
    trackEvent(EVENTS.Contacts.CivicPanelInviteSubmitted, {
      edited: message !== (initialScript ?? ''),
      usedImproveWithAi: managedUsedAiRef.current,
      usedDictation: managedUsedDictationRef.current,
      inviteSegments: Math.max(1, Math.ceil(composedLength / 160)),
    })
    managedApprove.mutate(composedMessage, {
      onSuccess: () => managedInvite?.onSetUp(),
      onError: () => setManagedError(true),
    })
  }

  // A required line the official deleted, put back where the flow writes it.
  const handleAddRequiredBack = (rule: SmsRequiredPart) => {
    const [greeting = ''] = surface.composeMessage('', null).split('\n\n')
    const next =
      rule === 'opt_out_line'
        ? optOutUnderLastLine
          ? withOptOutUnderLastLine(addOptOutBack(message))
          : addOptOutBack(message)
        : rule === 'first_name_token'
          ? addGreetingBack(message, greeting)
          : rule === 'candidate_name'
            ? addIdentificationBack(message, {
                greeting,
                intro: introFor(tone),
              })
            : rule === 'paid_for_by' && footerCommittee
              ? addPaidForByBack(message, footerCommittee)
              : message
    if (next === message) return
    handleMessageChange(next)
  }

  const handleUndo = () => {
    if (undoText === null) return
    draftRequestRef.current += 1
    resetDraftMutation()
    loadMessage(undoText)
    setUndoText(null)
    setOwnWords(true)
  }

  // Name-step continue: create the list through the shared audience hook
  // (same endpoint the CRM wizard uses; the hook selects it and refreshes
  // both list caches), derive its phone list, and land on the compose step —
  // the prototype's build-and-keep-going path.
  const handleCreateListContinue = async () => {
    if (surface.isServe) return serveSend.createListContinue()
    if (audience.builderName.trim().length === 0 || audience.createListPending)
      return
    setPhoneListError(false)
    try {
      const created = await audience.createList()
      if (buildMode) {
        setStepId('compose')
        return
      }
      setPhoneListToken(null)
      setPhoneListBuildId(null)
      setPhoneList(null)
      setStopPolling(false)
      setPhoneListBuildFailed(false)
      setPhoneListCreating(true)
      const result = await createP2pPhoneList(created, created.id)
      setPhoneListCreating(false)
      if (!phoneListResultUsable(result)) {
        setPhoneListError(true)
        return
      }
      setPhoneListToken(result.token)
      setPhoneListBuildId(result.buildId)
      setStepId('compose')
    } catch {
      setPhoneListCreating(false)
      // audience.createListError renders the inline message below.
    }
  }

  // Recommendation flow: create the saved filter, derive its phone list,
  // and advance to compose in one atomic gesture. Reached from the naming
  // drawer (a tapped card, the candidate's own name) and from the shell's
  // Continue over a selected card (the recommendation's own title). Only
  // the create may throw. Past it the list exists under that name and is
  // selected, so a phone-list failure is the audience step's error (same as
  // handleAudienceContinue) — thrown further it read as "couldn't save this
  // list" and every retry POSTed a duplicate.
  const continueWithRecommendation = async (
    recommendation: RecommendedList,
    name: string,
  ) => {
    if (surface.isServe)
      return serveSend.continueWithRecommendation(recommendation, name)
    const created = await audience.createRecommendedList(recommendation, name)
    if (buildMode) {
      setStepId('compose')
      return
    }
    // Same reset as onSelect: a token left over from a previously picked
    // list would let a retry skip straight to compose with the wrong
    // audience.
    setPhoneListToken(null)
    setPhoneListBuildId(null)
    setPhoneList(null)
    setStopPolling(false)
    setPhoneListError(false)
    setPhoneListBuildFailed(false)
    setPhoneListCreating(true)
    const result = await createP2pPhoneList(created, created.id)
    setPhoneListCreating(false)
    if (!phoneListResultUsable(result)) {
      setPhoneListError(true)
      return
    }
    setPhoneListToken(result.token)
    setPhoneListBuildId(result.buildId)
    setStepId('compose')
  }

  const handleSelectedRecommendationContinue = async () => {
    if (!audience.selectedRecommendation) return
    try {
      await continueWithRecommendation(
        audience.selectedRecommendation,
        audience.selectedRecommendation.copy.title,
      )
    } catch {
      // audience.createRecommendedListError renders under the cards.
    }
  }

  // Audience advance: derive the Peerly phone list from the saved filter.
  // The status poll runs across the later steps; the pay step waits on it.
  const handleAudienceContinue = async () => {
    if (surface.isServe) return serveSend.audienceContinue()
    if (!selectedList) return
    // A draft is never submitted to Peerly, so build mode skips the phone
    // list entirely; the resume creates it once the send is real.
    if (buildMode) {
      setStepId('compose')
      return
    }
    if (phoneListToken) {
      setStepId('compose')
      return
    }
    setPhoneListCreating(true)
    setPhoneListError(false)
    setPhoneListBuildFailed(false)
    const result = await createP2pPhoneList(selectedList, selectedList.id)
    setPhoneListCreating(false)
    if (!phoneListResultUsable(result)) {
      setPhoneListError(true)
      return
    }
    setPhoneListToken(result.token)
    setPhoneListBuildId(result.buildId)
    setStepId('compose')
  }

  // A flow that lands on the message opens past the audience step, so on Win
  // it derives the phone list there the way that step's Continue would have,
  // once per open. A failure goes back to the audience step, where the error
  // and its retry live.
  const cardPhoneListStartedRef = useRef(false)
  useEffect(() => {
    if (!open) {
      cardPhoneListStartedRef.current = false
      return
    }
    if (!opensOnMessage || surface.isServe || buildMode) return
    if (cardPhoneListStartedRef.current || !selectedList) return
    if (selectedList.id !== preselectedListId) return
    cardPhoneListStartedRef.current = true
    void (async () => {
      setPhoneListCreating(true)
      setPhoneListError(false)
      setPhoneListBuildFailed(false)
      const result = await createP2pPhoneList(selectedList, selectedList.id)
      setPhoneListCreating(false)
      if (!phoneListResultUsable(result)) {
        setPhoneListError(true)
        setStepId('audience')
        return
      }
      setPhoneListToken(result.token)
      setPhoneListBuildId(result.buildId)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per open, when the card's list resolves
  }, [open, opensOnMessage, buildMode, selectedList, preselectedListId])

  // A resumed row's image lives on the server, so there is no local File to
  // build an object URL from.
  const previewUrl =
    imagePreviewUrl ?? (resumed ? (savedDraft?.imageUrl ?? null) : null)

  const handleDraftSaved = async () => {
    await (onDraftSaved ?? onScheduled)()
  }

  // Build mode's one write, assembled here because only this flow knows the
  // multipart payload and what has to be in hand before there is anything to
  // save. The 201/409 branching is the shared hook's.
  const createDraftRow = async () => {
    if (!audience.selectedListId || !image) return null
    return createOutreachDraft(
      {
        outreachType: 'p2p',
        name: name.trim(),
        voterFileFilterId: audience.selectedListId,
        script: composedMessage,
        ...(tracker ? { trackerTaskId: tracker.trackerTaskId } : {}),
      },
      image,
    )
  }

  // Resume's schedule advance: the audience and the message were settled
  // when the draft was built, so this is where the Peerly phone list the
  // purchase needs finally gets derived.
  const handleResumeScheduleContinue = async () => {
    // The CTA is disabled without a date, but review is a checkout step:
    // nothing reaches it on a resumed row until the date exists.
    if (scheduledAt === null) return
    if (phoneListToken) {
      setStepId('review')
      return
    }
    if (!selectedList || phoneListCreating) return
    setPhoneListCreating(true)
    setPhoneListError(false)
    setPhoneListBuildFailed(false)
    const result = await createP2pPhoneList(selectedList, selectedList.id)
    setPhoneListCreating(false)
    if (!phoneListResultUsable(result)) {
      setPhoneListError(true)
      return
    }
    setPhoneListToken(result.token)
    setPhoneListBuildId(result.buildId)
    setStepId('review')
  }

  // Review-step retry: a build the poll resolved to `failed` has nothing
  // left to poll (the row stays `failed`), so this re-requests a fresh one
  // from the same selected list rather than re-polling the dead buildId.
  const handleRetryPhoneListBuild = async () => {
    if (!selectedList || phoneListCreating) return
    setPhoneListBuildFailed(false)
    setPhoneListToken(null)
    setPhoneListBuildId(null)
    setPhoneList(null)
    setStopPolling(false)
    setPhoneListCreating(true)
    const result = await createP2pPhoneList(selectedList, selectedList.id)
    setPhoneListCreating(false)
    if (!phoneListResultUsable(result)) {
      setPhoneListBuildFailed(true)
      return
    }
    setPhoneListToken(result.token)
    setPhoneListBuildId(result.buildId)
  }

  // First compose entry generates the initial draft (custom writes its own).
  useEffect(() => {
    if (stepId !== 'compose' || !open) return
    if (purpose === 'custom' || message.trim() || draftMutation.isPending)
      return
    requestDraft(purpose, tone, '', false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepId, open])

  // Draft-first purchase: entering review persists the campaign as a
  // pending_payment draft once the phone list is ready — the draft id gates
  // the checkout session (legacy TaskFlow sequence, relocated).
  useEffect(() => {
    if (surface.isServe) return
    if (stepId !== 'review' || !open || scheduled) return
    // Build mode has nothing to charge for yet — the summary's own CTA
    // writes the draft instead.
    if (buildMode) return
    if (draftOutreachId || isDraftCreatingRef.current) return
    // A dateless resumed row must never reach the create: `scheduledAt`
    // covers it, and is load-bearing rather than defensive.
    if (!campaign?.id || !scheduledAt) return
    // The list must be built before the draft — UNLESS a paid hold-billing send
    // is paying before the build is ready (payBeforeReady), where the draft is
    // created with no numeric phoneListId and gp-api's build-ready finalize edge
    // stamps it and submits the send once the list exists.
    if (!phoneList?.phoneListId && !payBeforeReady) return
    isDraftCreatingRef.current = true
    setDraftCreateError(false)
    setDraftCreateErrorMessage(null)
    const generation = draftGenerationRef.current
    // Pre-build (pay-before-ready): the count is the pre-pay estimate, a ceiling
    // gp-api's capture bills down to the actual leads_loaded. Once ready it is
    // the real leads_loaded (unchanged).
    const count = phoneList?.leadsLoaded ?? reachableCount ?? 0
    const discount = campaign?.hasFreeTextsOffer
      ? Math.min(count, FREE_TEXTS_OFFER.COUNT)
      : 0
    // Never beside draftOutreachId: the server takes a card's key on a fresh
    // draft only, since a saved one was built without it.
    const sendsProposalKey =
      proposalLink !== undefined && !(resumed && savedDraft)
    ;(async () => {
      try {
        const outreach = await createOutreach(
          {
            campaignId: campaign.id,
            outreachType: OUTREACH_TYPES.p2p,
            name: name.trim(),
            message: composedMessage,
            script: composedMessage,
            title: `P2P Outreach - Campaign ${campaign.id}`,
            // Offset-annotated time in the campaign's zone, not
            // toISOString(): the server slices the first 10 chars as the
            // send DAY for Peerly, and the UTC rendering puts evening sends
            // on the next day.
            date: formatInTimeZone(
              scheduledAt,
              timeZone,
              "yyyy-MM-dd'T'HH:mm:ssXXX",
            ),
            // The wall-clock time as picked — approve opens Peerly's send
            // window at it, read in the same campaign zone.
            scheduledLocalTime: formatInTimeZone(
              scheduledAt,
              timeZone,
              'HH:mm',
            ),
            ...(audience.selectedListId
              ? { voterFileFilterId: audience.selectedListId }
              : {}),
            // Omitted on the pay-before-ready path (null until the build
            // finishes); gp-api accepts a null phoneListId under the flag and
            // stamps it at the build-ready finalize edge.
            ...(phoneList?.phoneListId
              ? { phoneListId: phoneList.phoneListId }
              : {}),
            textCount: count,
            billableTextCount: count - discount,
            ...(campaignPlanDueDate ? { campaignPlanDueDate } : {}),
            ...(tracker ? { trackerTaskId: tracker.trackerTaskId } : {}),
            // Resume: the server converts this row in place, so no second
            // row is written and the saved image and script stand.
            ...(resumed && savedDraft
              ? { draftOutreachId: savedDraft.id }
              : {}),
            ...(sendsProposalKey
              ? { proposalKey: proposalLink.proposalKey }
              : {}),
            draft: true,
          },
          resumed ? null : image,
          (message) => {
            if (generation === draftGenerationRef.current)
              setDraftCreateErrorMessage(message)
          },
        )
        if (generation !== draftGenerationRef.current) return
        if (outreach?.id) {
          setDraftOutreachId(outreach.id)
          // The draft row IS the campaign: it exists, it is scheduled, and it
          // has an audience — everything except the payment that completes it.
          // Fired per draft, so going Back to change the audience and coming
          // forward again reports the second campaign it really creates.
          //
          // NOT on a resume: this create converts a saved `draft` row in
          // place, and that row already reported itself created when the
          // gate saved it.
          if (!resumed)
            trackEvent(
              EVENTS.Dashboard.VoterContact.CampaignCreated,
              outreachEventProps({
                channel: 'text',
                isServe: surface.isServe,
                campaignName: name.trim(),
                recipientCount: count,
                sendDate: scheduledAt,
                outreachCampaignId: outreach.id,
                ...(audience.selectedListId !== null
                  ? { listId: audience.selectedListId }
                  : {}),
                audienceSource: audience.selectedRecommendation
                  ? 'recommended'
                  : 'savedList',
                ...(tracker ? { tracker } : {}),
                ...(launchSource ? { launchSource } : {}),
                ...(purpose ? { purpose } : {}),
              }),
            )
        } else {
          setDraftCreateError(true)
          if (sendsProposalKey) onProposalCreateFailed?.()
        }
      } finally {
        if (generation === draftGenerationRef.current) {
          isDraftCreatingRef.current = false
        }
      }
    })()
  }, [
    stepId,
    open,
    scheduled,
    buildMode,
    resumed,
    savedDraft,
    draftOutreachId,
    campaign,
    phoneList,
    payBeforeReady,
    reachableCount,
    scheduledAt,
    composedMessage,
    name,
    audience.selectedListId,
    image,
    proposalLink,
    onProposalCreateFailed,
  ])

  const handleScheduled = async (paid: boolean) => {
    setPaidSend(paid)
    setScheduled(true)
    // A text campaign completes when it is bought and scheduled, not when
    // Peerly sends it — the send is hours or days later and nothing on the
    // client is alive to see it. `sendDate` carries that gap: it is the
    // scheduled day, never the event's own timestamp.
    // Pay-before-ready: the list is still building at completion, so fall back
    // to the estimate the send was priced on — never report 0 recipients / $0
    // for a paid pre-build send.
    const completedCount = phoneList?.leadsLoaded ?? reachableCount ?? 0
    const discount = campaign?.hasFreeTextsOffer
      ? Math.min(completedCount, FREE_TEXTS_OFFER.COUNT)
      : 0
    const billable = Math.max(completedCount - discount, 0)
    trackEvent(EVENTS.Dashboard.VoterContact.CampaignCompleted, {
      ...outreachEventProps({
        channel: 'text',
        isServe: surface.isServe,
        campaignName: name.trim(),
        recipientCount: completedCount,
        sendDate: scheduledAt,
        // Always present on a paid channel, 0 included: a send fully covered
        // by the free-texts offer is a zero-cost text campaign, not a channel
        // without a price.
        price: paid ? billable * PRICE_PER_MESSAGE : 0,
        ...(draftOutreachId !== null
          ? { outreachCampaignId: draftOutreachId }
          : {}),
        ...(audience.selectedListId !== null
          ? { listId: audience.selectedListId }
          : {}),
        audienceSource: audience.selectedRecommendation
          ? 'recommended'
          : 'savedList',
        ...(tracker ? { tracker } : {}),
        ...(launchSource ? { launchSource } : {}),
        ...(purpose ? { purpose } : {}),
        ...(proposalLink?.priorityId
          ? { priorityId: proposalLink.priorityId }
          : {}),
        ...(surface.isServe
          ? {
              asksToJoinCivicPanel:
                findCivicPanelJoinLine(composedMessage) !== null,
            }
          : {}),
      }),
    })
    await onScheduled()
  }

  const stepIndex = stepOrder.indexOf(stepId)

  const handleBack = () => {
    if (stepId === 'audience' && audience.mode === 'name') {
      // Drop any failed-create error so it can't re-flash on re-entry; keep
      // the built filters.
      audience.clearCreateError()
      audience.setMode('filters')
      return
    }
    if (stepId === 'audience' && audience.mode === 'filters') {
      audience.resetBuilder()
      return
    }
    // Resume converts the saved row rather than creating a throwaway one, so
    // discarding its id would strand the row: the re-entry POST would meet a
    // draft that is already pending_payment and 409.
    if (stepId === 'review' && !resumed) {
      // Back off the pay step discards the draft (stale drafts stay hidden
      // server-side); re-entry creates a fresh one.
      draftGenerationRef.current += 1
      isDraftCreatingRef.current = false
      setDraftOutreachId(null)
      setFollowUp(null)
      setDraftCreateError(false)
      // A build the poll resolved to `failed` is dead state, not a snapshot
      // worth keeping — left alone, re-entering review would show the exact
      // same failure card from before the edit instead of giving the edited
      // campaign its own shot. Re-request it the same way the review step's
      // own retry does, rather than only clearing the flags: nothing else
      // triggers a build between the audience step and review, so clearing without
      // rebuilding would strand review on a permanent "preparing" spinner. A
      // build still in flight or one that already succeeded is untouched —
      // the audience didn't change, so a completed phoneList survives
      // Back/forward without a needless rebuild.
      if (phoneListBuildFailed) {
        void handleRetryPhoneListBuild()
      }
    }
    const previous = stepOrder[stepIndex - 1]
    if (previous) setStepId(previous)
  }

  // Closing the managed invite without setting it up sends nothing.
  const closeFlow = managed
    ? () => {
        if (!managedApprove.isSuccess) {
          trackEvent(EVENTS.Contacts.CivicPanelInviteReviewDismissed, {
            edited: message !== (initialScript ?? ''),
          })
        }
        onClose()
      }
    : onClose

  // A saved draft is the opposite of unsaved work: closing loses nothing.
  const dirty = managed
    ? message !== (initialScript ?? '') || managedConsent
    : !scheduled && purpose !== null && savedDraft === null

  const reviewGateCta =
    gate.requirement !== null ? REVIEW_GATE_CTA[gate.requirement] : undefined
  const baseCta: FlowShellCta | null = scheduled
    ? null
    : // The gate screens carry their own buttons.
      gateOpen
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
              audience.builderCapError ||
              builderOverCap,
            loading:
              hasAnyVoterFileSelection(
                audience.builderFilters,
                audience.builderSupportStatus,
                audience.builderPrecincts,
              ) && audience.builderCounting,
          }
        : stepId === 'audience' && audience.mode === 'name'
          ? {
              label: 'Continue',
              onClick: () => {
                void handleCreateListContinue()
              },
              disabled: audience.builderName.trim().length === 0,
              loading: audience.createListPending || phoneListCreating,
            }
          : stepId === 'audience'
            ? {
                label: phoneListError
                  ? 'Try again'
                  : reachableCount !== null
                    ? `Continue (${reachableCount.toLocaleString()})`
                    : 'Continue',
                onClick: () => {
                  if (audience.selectedRecommendation) {
                    void handleSelectedRecommendationContinue()
                    return
                  }
                  void handleAudienceContinue()
                },
                disabled:
                  (!selectedList && !audience.selectedRecommendation) ||
                  audience.reachableLoading ||
                  reachableCount === null ||
                  reachableCount === 0 ||
                  reachableOverCap,
                // A list the naming drawer just created lands here with its
                // reachability fetch still in flight, so "Try again" would sit
                // disabled with no explanation until the count resolves.
                loading:
                  audience.createRecommendedListPending ||
                  phoneListCreating ||
                  (phoneListError && audience.reachableLoading),
              }
            : // Build mode's name step is where the draft is written: a
              // free tier goes to the Pro gate from here, and a Pro candidate
              // who still has to verify reads the summary first.
              stepId === 'schedule' && buildMode
              ? {
                  label: 'Continue',
                  onClick: () => {
                    if (gate.requirement === 'pro') {
                      void draftGate.saveDraft('Continue')
                      return
                    }
                    setStepId('review')
                  },
                  disabled:
                    name.trim().length === 0 ||
                    !audience.selectedListId ||
                    image === null,
                  loading: draftGate.savingDraft,
                }
              : stepId === 'schedule'
                ? {
                    label: 'Continue',
                    onClick: () => {
                      if (resumed) {
                        void handleResumeScheduleContinue()
                        return
                      }
                      setStepId('review')
                    },
                    disabled:
                      name.trim().length === 0 ||
                      scheduledAt === null ||
                      violates48h ||
                      outsideWindow ||
                      // The resume derives its phone list from this list:
                      // nothing to press until it resolves, and nothing at all
                      // if it has been deleted since the draft was saved.
                      (resumed && !selectedList),
                    loading: resumed && phoneListCreating,
                  }
                : stepId === 'compose'
                  ? {
                      label: 'Continue',
                      // Stays pressable while something is missing: a press
                      // shows what (design rule 4) instead of a dead button.
                      onClick: () => {
                        const ready =
                          hasWrittenBody &&
                          standards.passed &&
                          bracketsToFill.length === 0 &&
                          composedLength <= SMS_COMPOSED_MAX_LENGTH &&
                          // Both surfaces send MMS: the image lifts the text
                          // past single-SMS segment limits, and Peerly
                          // rejects an imageless Win text/p2p send.
                          image !== null
                        if (!ready) {
                          setComposeContinueAttempts((n) => n + 1)
                          return
                        }
                        setStepId('schedule')
                      },
                      disabled: draftMutation.isPending,
                    }
                  : // Build mode's review has nothing to pay for: the CTA saves
                    // the draft and hands the flow to the gate, named for
                    // whatever still stands in the way.
                    stepId === 'review' &&
                      buildMode &&
                      gate.requirement !== null
                    ? {
                        label: REVIEW_GATE_CTA[gate.requirement],
                        onClick: () => {
                          void draftGate.saveDraft(reviewGateCta)
                        },
                        disabled: !audience.selectedListId || image === null,
                        loading: draftGate.savingDraft,
                      }
                    : null

  const cta: FlowShellCta | null = managed
    ? {
        label: MANAGED_PANEL_COPY.flow.submit,
        onClick: handleManagedSetUp,
        disabled: !managedConsent || draftMutation.isPending,
        loading: managedApprove.isPending,
      }
    : stepId === 'details' && !scheduled && !gateOpen
      ? {
          label: 'Continue',
          onClick: handleEventDetailsContinue,
          disabled: eventDetails.event === null,
        }
      : baseCta

  // gp-api has closed texting for this race, so nothing built here could
  // send: the notice stands in for the whole flow, before build mode, a
  // resumed draft or the gate. A send that already settled keeps its
  // success screen.
  if (gate.requirement === 'closed' && !scheduled) {
    return (
      <OutreachFlowShell
        open={open}
        onClose={onClose}
        title={SMS_CUTOFF_COPY.closedReason(
          smsCutoffDate ? formatSmsCutoffDate(smsCutoffDate) : null,
        )}
        currentStep={0}
        totalSteps={0}
        cta={null}
        dirty={false}
      >
        <SmsCutoffNotice
          variant="screen"
          surface="sms_flow"
          onBack={onClose}
          onPick={onClose}
        />
      </OutreachFlowShell>
    )
  }

  return (
    <OutreachFlowShell
      open={open}
      onClose={closeFlow}
      title={
        managed
          ? MANAGED_PANEL_COPY.flow.title
          : scheduled
            ? 'Done'
            : showGateChrome
              ? gateChrome.overline
              : stepId === 'schedule' && buildMode
                ? NAME_ONLY_COPY.title
                : stepId === 'review' && buildMode
                  ? 'Review and verify'
                  : stepId === 'review' && isFreeSend
                    ? 'Review and send'
                    : STEP_TITLES[stepId]
      }
      headerBadge={
        managed ? (
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <MessagesSquareIcon className="size-4" aria-hidden />
            {MANAGED_PANEL_COPY.flow.header}
          </span>
        ) : showGateChrome ? (
          gateChrome.overline
        ) : (
          <ChannelBadge
            type={OUTREACH_TYPES.text}
            locked={gate.requirement !== null && !scheduled && !gateOpen}
          />
        )
      }
      channel="sms"
      source={source}
      locked={lockedAtOpen}
      trackedStep={scheduled || showGateChrome ? null : stepId}
      settled={scheduled}
      currentStep={showGateChrome ? gateChrome.currentStep : stepIndex + 1}
      totalSteps={
        scheduled
          ? 0
          : showGateChrome
            ? gateChrome.totalSteps
            : stepOrder.length
      }
      backExits={managed}
      onBack={
        managed
          ? closeFlow
          : // A resume has no reachable step behind it at all: purpose, audience
            // and compose were settled when the draft was saved, and compose
            // could never advance again (its Continue needs a local image file
            // the saved row cannot supply).
            !scheduled && !gateOpen && !resumed && stepIndex > 0
            ? handleBack
            : undefined
      }
      cta={cta}
      // A React element is truthy even when it renders null, so the caller
      // gates the JSX (see GateBanner).
      banner={
        gate.requirement !== null && !scheduled && !gateOpen ? (
          <GateBanner
            channel="sms"
            state={gate}
            onOpenExplainer={() => draftGate.setExplainerOpen(true)}
          />
        ) : undefined
      }
      dirty={dirty}
    >
      {phoneListBuildId && !phoneList && (
        // Keyed on the buildId so a retry (a fresh buildId) remounts this
        // rather than resuming a poll loop that already ran out its
        // setTimeout chain after the previous build's terminal state.
        // `limit`: gp-api's status route maps every non-2xx -- including a
        // permanent 404 for a build row that is genuinely gone -- to "keep
        // polling" (see getP2pPhoneListBuildStatus), so this loop is the only
        // thing standing between a stuck/missing build and a silent,
        // permanent spinner. PHONE_LIST_BUILD_POLL_LIMIT is sized generously
        // (minutes, not the expected build duration) so it never cuts off a
        // legitimately long async build.
        <LongPoll<PhoneListBuildStatusResult>
          key={phoneListBuildId}
          pollingMethod={async () =>
            getP2pPhoneListBuildStatus(phoneListBuildId)
          }
          onSuccess={(result) => {
            // `getP2pPhoneListBuildStatus` always resolves to a value — this
            // guard is only here because LongPoll's signature allows `void`.
            if (!result) return false
            if (result.buildStatus === 'ready') {
              const {
                phoneListId,
                leadsLoaded,
                excludedOptedOutCount,
                excludedDuplicatePhoneCount,
              } = result
              setPhoneList({
                phoneListId,
                leadsLoaded,
                excludedOptedOutCount,
                excludedDuplicatePhoneCount,
              })
              setStopPolling(true)
              // Terminal this tick -- told synchronously so a `ready` on the
              // last allowed attempt doesn't also trip `onLimitReached`.
              return true
            }
            if (result.buildStatus === 'failed') {
              setPhoneListBuildFailed(true)
              setStopPolling(true)
              return true
            }
            // 'building': keep polling, nothing changes yet.
            return false
          }}
          limit={PHONE_LIST_BUILD_POLL_LIMIT}
          onLimitReached={() => {
            setPhoneListBuildFailed(true)
            setStopPolling(true)
          }}
          stopPolling={stopPolling}
        />
      )}
      <GateExplainerModal
        channel="sms"
        state={gate}
        open={explainerOpen}
        onOpenChange={draftGate.setExplainerOpen}
        onUpgrade={draftGate.openGateFromExplainer}
        onVerify={draftGate.openGateFromExplainer}
        onPin={draftGate.openGateFromExplainer}
      />
      {scheduled ? (
        <SuccessScreen
          contactCount={phoneList?.leadsLoaded ?? reachableCount ?? 0}
          sendAt={scheduledAt}
          timeZone={fixedMorningSchedule ? undefined : timeZone}
          outreachId={draftOutreachId}
          paid={paidSend}
          onDone={onClose}
        />
      ) : gateOpen ? (
        <OutreachGate
          channel="sms"
          state={gate}
          open
          showInterstitial={
            draftGate.gateOrigin === 'save' ||
            (draftGate.gateOrigin === 'resume' && !resumeStartsOnWizard)
          }
          onExit={draftGate.handleGateExit}
          onComplete={draftGate.handleGateComplete}
          onChromeChange={setGateChrome}
          source={source}
          cta={draftGate.gateCta}
          tracker={tracker}
        />
      ) : stepId === 'purpose' ? (
        <SmsPurposeStep
          selected={purpose}
          onSelect={handleSelectPurpose}
          purposes={purposes}
          introBody={surface.purposeIntroBody}
        />
      ) : stepId === 'details' ? (
        <EventDetailsStep
          details={eventDetails.details}
          onChange={eventDetails.setDetails}
          destination="message"
          prefillNote={eventDetails.prefillNote}
        />
      ) : stepId === 'audience' ? (
        <>
          <OutreachAudienceStep
            channel="text"
            copy={surface.audienceCopy}
            mode={audience.mode}
            lists={audience.lists}
            listsLoading={audience.listsLoading}
            selectedId={audience.selectedListId}
            onSelect={(id) => {
              audience.onSelect(id)
              // A different audience needs a fresh phone list, and a stale
              // "couldn't prepare" error from the last attempt is moot.
              setPhoneListToken(null)
              setPhoneListBuildId(null)
              setPhoneList(null)
              setStopPolling(false)
              setPhoneListError(false)
              setPhoneListBuildFailed(false)
            }}
            universeName={audience.universeName}
            universeListId={audience.universeListId}
            universeCount={audience.universeCount}
            universeLoading={audience.universeLoading}
            onSelectUniverse={audience.selectUniverse}
            universePending={audience.universePending}
            universeError={audience.universeError}
            onPickerOpenChange={audience.onPickerOpenChange}
            onStartBuilder={() => {
              setPhoneListError(false)
              audience.startBuilder()
            }}
            recommendations={audience.recommendations}
            recommendationsLoading={audience.recommendationsLoading}
            recommendationsError={audience.recommendationsError}
            recommendedListsChannel={audience.recommendedListsChannel}
            onCreateRecommendedList={continueWithRecommendation}
            onRecommendationReused={audience.trackRecommendationReused}
            selectedRecommendation={audience.selectedRecommendation}
            onSelectRecommendation={(recommendation) => {
              audience.selectRecommendation(recommendation)
              setPhoneListToken(null)
              setPhoneListBuildId(null)
              setPhoneList(null)
              setStopPolling(false)
              setPhoneListError(false)
              setPhoneListBuildFailed(false)
            }}
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
            pricePerContact={PRICE_PER_MESSAGE}
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
          {(reachableOverCap || builderOverCap) && (
            <p className="mt-4 text-sm text-destructive" role="alert">
              {`This list reaches over ${SMS_MAX_RECIPIENTS.toLocaleString()} people, which is more than one text campaign can send to. Narrow your filters and try again.`}
            </p>
          )}
          {audience.createListError && (
            <p className="mt-4 text-sm text-destructive">
              We couldn&apos;t save this list. Try again.
            </p>
          )}
          {phoneListError && (
            <p className="mt-4 text-sm text-destructive">
              We couldn&apos;t prepare this audience. Try again.
            </p>
          )}
        </>
      ) : stepId === 'schedule' ? (
        fixedMorningSchedule ? (
          <ServeSmsScheduleStep
            name={name}
            onNameChange={(value) => {
              setName(value)
              setNameEdited(value !== lastAutoName.current)
            }}
            date={date}
            onDateChange={setDate}
          />
        ) : (
          <>
            <SmsScheduleStep
              name={name}
              onNameChange={(value) => {
                setName(value)
                setNameEdited(value !== lastAutoName.current)
              }}
              nameOnly={buildMode}
              date={date}
              onDateChange={setDate}
              timeSlot={timeSlot}
              onTimeSlotChange={setTimeSlot}
              customTime={customTime}
              onCustomTimeChange={setCustomTime}
              timeZone={timeZone}
              earliestSend={earliestSend}
              calendarFloor={earliestSend}
              violates48h={violates48h}
              outsideWindow={outsideWindow}
            />
            {/* Resume derives the phone list here, so its failure reads here
              too — the audience step is behind the candidate. */}
            {resumed && !audience.listsLoading && !selectedList && (
              <p className="mt-4 text-sm text-destructive">
                The voter list for this text is no longer available.
              </p>
            )}
            {resumed && phoneListError && (
              <p className="mt-4 text-sm text-destructive">
                We couldn&apos;t prepare this audience. Try again.
              </p>
            )}
            {buildMode && draftGate.draftSaveError && (
              <p className="mt-4 text-sm text-destructive">
                We couldn&apos;t save this draft. Try again.
              </p>
            )}
          </>
        )
      ) : stepId === 'compose' ? (
        <>
          <SmsComposeStep
            isServe={surface.isServe}
            tone={tone}
            onToneChange={handleToneChange}
            standardsFailures={standards.failures}
            restrictedWords={findSmsRestrictedWords(composedMessage)}
            unfilledBrackets={bracketsToFill}
            identificationExample={introFor(tone)}
            paidForByText={
              footerCommittee ? paidForByLine(footerCommittee) : null
            }
            onAddRequiredBack={handleAddRequiredBack}
            message={message}
            onMessageChange={handleMessageChange}
            mergeTagChannel={surface.isServe ? 'serve' : 'peerly'}
            hasWrittenBody={hasWrittenBody}
            composedLength={composedLength}
            aiAction={aiAction}
            onAiAction={handleAiAction}
            isDrafting={draftMutation.isPending}
            isDraftError={draftMutation.isError}
            canUndo={undoText !== null}
            onUndo={handleUndo}
            imagePreviewUrl={imagePreviewUrl}
            onImageChange={setImage}
            imageError={imageError}
            onImageError={setImageError}
            continueAttempts={composeContinueAttempts}
            {...(managed && {
              onDictated: () => {
                managedUsedDictationRef.current = true
              },
              managedInvite: {
                title: MANAGED_PANEL_COPY.flow.title,
                caption: MANAGED_PANEL_COPY.flow.caption(
                  managedInvite?.place ?? null,
                ),
                lockedLines: MANAGED_INVITE_LOCKED_LINES,
                consent: {
                  label: MANAGED_PANEL_COPY.flow.consent,
                  checked: managedConsent,
                  onChange: setManagedConsent,
                },
              },
            })}
          />
          {managed && managedError ? (
            <p className="mt-4 text-sm text-destructive" role="alert">
              {MANAGED_PANEL_COPY.flow.error}
            </p>
          ) : null}
        </>
      ) : (
        <CheckoutSessionProvider
          key={draftOutreachId ?? 'pending'}
          type={
            surface.isServe ? PURCHASE_TYPES.SERVE_TEXT : PURCHASE_TYPES.TEXT
          }
          purchaseMetaData={{
            // Pay-before-ready: the estimate stands in for leads_loaded. gp-api
            // re-derives the billed amount from the draft's phone list, so
            // this is only a hint.
            contactCount:
              phoneList?.leadsLoaded ??
              (payBeforeReady ? (reachableCount ?? 0) : 0),
            outreachType: surface.isServe
              ? OUTREACH_TYPES.text
              : OUTREACH_TYPES.p2p,
            campaignId: campaign?.id,
            outreachId: draftOutreachId ?? undefined,
            // gp-api prices the draft's own list; the build id is read only
            // for a draft paid before its build finished.
            phoneListBuildId: phoneListBuildId ?? undefined,
          }}
        >
          <SmsReviewStep
            isServe={surface.isServe}
            name={name}
            audienceName={selectedList?.name ?? 'Saved list'}
            sendAt={scheduledAt ?? new Date()}
            timeZone={fixedMorningSchedule ? undefined : timeZone}
            composedMessage={composedMessage}
            imagePreviewUrl={previewUrl}
            contactCount={
              buildMode
                ? reachableCount
                : (phoneList?.leadsLoaded ??
                  (payBeforeReady ? reachableCount : 0))
            }
            pricePerContact={PRICE_PER_MESSAGE}
            {...(followUp && {
              followUp: {
                count: followUp.recipientCount,
                sendAt: parseISO(followUp.scheduledLocalDate),
              },
            })}
            outreachId={draftOutreachId}
            phoneListBuildId={phoneListBuildId}
            excludedOptedOutCount={phoneList?.excludedOptedOutCount ?? null}
            excludedDuplicatePhoneCount={
              phoneList?.excludedDuplicatePhoneCount ?? null
            }
            // Pay-before-ready: the amount is the estimate ceiling the capture
            // bills down to the actual reachable list — the pay card says so.
            priceIsCeiling={payBeforeReady}
            preparing={
              !buildMode &&
              !phoneListBuildFailed &&
              (payBeforeReady
                ? !draftOutreachId && !draftCreateError
                : !phoneList || (!draftOutreachId && !draftCreateError))
            }
            prepareError={draftCreateError}
            prepareErrorMessage={draftCreateErrorMessage}
            buildFailed={phoneListBuildFailed}
            retryingBuild={phoneListCreating}
            onRetryBuild={handleRetryPhoneListBuild}
            readOnlySummary={buildMode}
            onComplete={handleScheduled}
          />
          {draftGate.draftSaveError && (
            <p className="mt-4 text-sm text-destructive">
              We couldn&apos;t save this draft. Try again.
            </p>
          )}
        </CheckoutSessionProvider>
      )}
    </OutreachFlowShell>
  )
}
