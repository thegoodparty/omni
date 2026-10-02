'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
  checkSmsStandards,
  deriveSmsProtectedParts,
  SMS_COMPOSED_MAX_LENGTH,
} from '@goodparty_org/contracts'
import { Button, Card } from '@styleguide'
import { CircleCheckIcon, DownloadIcon } from '@styleguide/components/ui/icons'
import { clientRequest } from 'gpApi/typed-request'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import {
  outreachEventProps,
  type OutreachFlowSource,
  type OutreachTrackerOrigin,
} from '../../util/outreachAnalytics'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useUser } from '@shared/hooks/useUser'
import { LongPoll } from '@shared/utils/LongPoll'
import {
  createP2pPhoneList,
  getP2pPhoneListStatus,
  type PhoneListStatusResponse,
} from 'helpers/createP2pPhoneList'
import { createOutreach } from 'helpers/createOutreach'
import { createOutreachDraft } from 'helpers/createOutreachDraft'
import { CheckoutSessionProvider } from 'app/dashboard/purchase/components/CheckoutSessionProvider'
import {
  OUTREACH_OPTIONS,
  OUTREACH_TYPES,
  FREE_TEXTS_OFFER,
} from 'app/dashboard/outreach/constants'
import { PURCHASE_TYPES } from 'helpers/purchaseTypes'
import { dollarsToCents } from 'helpers/numberHelper'
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
import { REVIEW_GATE_CTA } from '../gate/gateCopy'
import { useLockedAtOpen } from '../gate/useLockedAtOpen'
import { GateBanner } from '../gate/GateBanner'
import { GateExplainerModal } from '../gate/GateExplainerModal'
import { OutreachGate, type GateChrome } from '../gate/OutreachGate'
import { useOutreachGate } from '../gate/useOutreachGate'
import { useDraftGate } from '../gate/useDraftGate'
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
import { SmsComposeStep } from './SmsComposeStep'
import { SmsReviewStep } from './SmsReviewStep'
import {
  composeScript,
  composeServeScript,
  ensureSmsIdentification,
  identificationIntro,
  provisionalCommitteeName,
  openWithSmsIdentification,
  SMS_PURPOSES,
  type SmsFlowPurpose,
  unfilledBrackets,
  upgradeScriptFooter,
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
const STEP_ORDER: StepId[] = [
  'purpose',
  'audience',
  'schedule',
  'compose',
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

const PRICE_PER_MESSAGE =
  OUTREACH_OPTIONS.find((o) => o.type === OUTREACH_TYPES.text)?.cost ?? 0.035

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
  // A message the candidate is meant to send as written (Know Your
  // Opponent). It opens the flow on `custom`, the one purpose that never
  // AI-drafts, so the seeded words are what they edit rather than something
  // a draft immediately overwrites.
  initialScript?: string
  // What an agent's proposal knows about the event it invites people to; the
  // details step opens on it.
  initialEvent?: ProposalEvent
  preselectedListId?: number
  // An audience a chat card counted but did not save: the audience step
  // opens on the list builder already filled in, and saves it when the
  // official confirms and names it.
  proposedAudience?: ProposedAudience
  // The chat card proposal this flow was opened from. Rides on the Serve
  // create, so the draft holds the card's key (a paid one reads as sent and
  // cannot be paid twice) and the paid send puts the priority's check out.
  proposalLink?: ProposalLink
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
  initialScript,
  proposedAudience,
  proposalLink,
  preselectedListId,
  preselectedRecommendedVariant,
  resumeDraft = null,
  onDraftSaved,
  resumeStartsOnWizard = false,
  resumeCta,
}: SmsFlowProps) => {
  const [campaign] = useCampaign()
  const [user] = useUser()
  const gate = useOutreachGate('sms')
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
  // live in it as locked parts rather than around it as separate regions.
  const [message, setMessage] = useState('')
  // The message as the system last wrote it (a draft, a seed, an undo).
  // Locks are found in this, not in what is being typed, so a name the
  // candidate is halfway through typing never locks under their cursor.
  const [lockSource, setLockSource] = useState('')
  const [manuallyEdited, setManuallyEdited] = useState(false)
  // Whether the words are the candidate's (typed, seeded or polished) rather
  // than an untouched fresh draft. Picks the one AI action: Regenerate, or
  // Improve with AI.
  const [ownWords, setOwnWords] = useState(false)
  const [undoText, setUndoText] = useState<string | null>(null)
  const [toneDrafts, setToneDrafts] = useState<
    Partial<Record<SocialTone, string>>
  >({})

  const [phoneListToken, setPhoneListToken] = useState<string | null>(null)
  const [phoneListCreating, setPhoneListCreating] = useState(false)
  const [phoneListError, setPhoneListError] = useState(false)
  const [stopPolling, setStopPolling] = useState(false)
  const [phoneList, setPhoneList] = useState<PhoneListStatusResponse | null>(
    null,
  )

  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [date, setDate] = useState<Date | undefined>(undefined)
  const [timeSlot, setTimeSlot] = useState('10')
  const [customTime, setCustomTime] = useState('10:00')

  const [image, setImage] = useState<File | null>(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)

  const [draftOutreachId, setDraftOutreachId] = useState<number | null>(null)
  const [draftCreateError, setDraftCreateError] = useState(false)
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
  const stepOrder: StepId[] = isEventInvite(purpose)
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

  const draftMutation = useMutation({
    mutationFn: (input: SmsFlowDraftInput) => surface.endpoints.draft(input),
  })
  const { reset: resetDraftMutation } = draftMutation

  useEffect(() => {
    if (!open) return
    draftRequestRef.current += 1
    // A seeded message opens past the purpose picker on `custom`: the words
    // are already chosen, so asking what the candidate wants to do and then
    // drafting over them would throw the seed away. A carried-in
    // recommendation opens past it too, on the purpose its intent maps onto:
    // the candidate answered that question by picking the card.
    const carriedPurpose = preselectedRecommendedVariant
      ? purposeForRecommendedVariant(preselectedRecommendedVariant)
      : null
    // A resumed draft answered purpose, audience and compose when it was
    // built, so it opens on the one thing still missing.
    setStepId(
      resumeDraft
        ? 'schedule'
        : initialScript
          ? 'audience'
          : carriedPurpose
            ? isEventInvite(carriedPurpose)
              ? 'details'
              : 'audience'
            : 'purpose',
    )
    setPurpose(initialScript ? 'custom' : carriedPurpose)
    resetEventDetails()
    confirmedEventRef.current = null
    setTone('warm')
    const seeded = initialScript
      ? surface.composeMessage(initialScript, null)
      : ''
    setMessage(seeded)
    setLockSource(seeded)
    seedUncheckedRef.current = initialScript || null
    setManuallyEdited(Boolean(initialScript))
    setOwnWords(Boolean(initialScript))
    setUndoText(null)
    setToneDrafts({})
    resetAudience()
    setPhoneListToken(null)
    setPhoneListCreating(false)
    setPhoneListError(false)
    setStopPolling(false)
    setPhoneList(null)
    setName(resumeDraft?.name ?? '')
    setNameEdited(Boolean(resumeDraft?.name))
    setDate(undefined)
    setTimeSlot('10')
    setCustomTime('10:00')
    setImage(null)
    setImageError(null)
    setDraftOutreachId(null)
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
    preselectedRecommendedVariant,
    resumeDraft,
    surface,
  ])

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
  const candidateFirstName = candidateFullName.split(' ')[0] ?? ''
  // Serve's office comes from the org's position name, not from a campaign
  // row it does not have; the hook owns that derivation.
  const serveIntroFor = useServeSmsIdentification(candidateFirstName)
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
          candidateFirstName,
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
    firstName: candidateFirstName,
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
    setMessage(repaired)
    setLockSource(repaired)
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
    : provisionalCommitteeName(
        candidateFullName,
        campaign?.positionName || campaign?.details?.normalizedOffice || '',
      )
  const footerCommittee = committeeName ?? provisionalCommittee
  const upgradeFooter = (script: string) =>
    upgradeScriptFooter(script, footerCommittee)
  // A resumed row carries the script exactly as it was saved (intro, body and
  // system footer already joined), so it must not be composed a second time.
  // Only the system footer is upgraded: a draft saved before verification has
  // no paid-for-by line, and scheduling's server-side compliance check will
  // demand it against the committee that exists by resume time.
  const composedMessage =
    resumed && savedDraft?.script ? upgradeFooter(savedDraft.script) : message
  const composedLength = composedMessage.length
  const loadMessage = (next: string) => {
    setMessage(next)
    setLockSource(next)
  }
  // The committee resolves after the flow opens, so a message composed
  // before it has the opt-out line alone. Same upgrade a resumed draft gets.
  useEffect(() => {
    const upgraded = upgradeFooter(message)
    if (upgraded === message) return
    setMessage(upgraded)
    setLockSource(upgraded)
    // upgradeFooter is rebuilt each render from footerCommittee.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, footerCommittee])
  // The message with nothing written between its locked parts.
  const emptyMessage = surface.composeMessage('', footerCommittee)
  const hasWrittenBody =
    message.replace(/\s+/g, '') !== '' &&
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
  // Locks the provisional line too: the verdict ignores it, but the
  // candidate still must not edit the disclaimer out.
  const protectedParts = deriveSmsProtectedParts(lockSource, {
    candidateNames: identificationNames,
    committeeName: footerCommittee,
    channel: surface.isServe ? 'serve' : 'peerly',
    ignoredRules: surface.ignoredStandardsRules,
  })
  const bracketsToFill = unfilledBrackets(message)

  // Only fully verified campaigns can reach this flow (the 2026-08-28 full
  // gate), so the send floor is the hard 48-hour scheduling window.
  const earliestSend = useMemo(
    () => Date.now() + 48 * 60 * 60 * 1000,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute on
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
    ...(proposalLink && !resumeDraft && { proposalLink }),
    create: surface.endpoints.create,
    setStepId,
    setDraftOutreachId,
    setDraftCreateError,
    setRecipientCounts: setPhoneList,
    isDraftCreatingRef,
    draftGenerationRef,
  })

  // Auto-name from list + date until the user edits the name.
  const lastAutoName = useRef('')
  useEffect(() => {
    if (nameEdited) return
    // Purpose-independent on Win (the surface ignores the argument and
    // returns the same fallback), purpose-keyed on Serve.
    const listPart = selectedList?.name ?? surface.nameSuggestion(purpose ?? '')
    const datePart = date
      ? `, ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      : ''
    const auto = `${listPart} — SMS${datePart}`
    if (name === '' || name === lastAutoName.current) {
      setName(auto)
      lastAutoName.current = auto
    }
  }, [selectedList, date, name, nameEdited, surface, purpose])

  const requestDraft = (
    nextPurpose: SmsFlowPurpose | null,
    nextTone: SocialTone,
    priorMessage: string,
    priorManuallyEdited: boolean,
    currentDraft?: string,
  ) => {
    if (!nextPurpose) return
    if (nextPurpose === 'custom' && currentDraft === undefined) return
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
          if (priorManuallyEdited) {
            setUndoText(priorMessage)
            setManuallyEdited(false)
          }
          // The model writes the body only, so a fresh draft is composed
          // around it here: greeting, the identification (the body's
          // editable first sentence, replacing any the model wrote),
          // disclaimer and opt-out. Improve sends the whole message and gets
          // the whole message back as is: gp-api locks the name, so a reply
          // cannot drop it, and repairing the identification here would put
          // an intro in front of the greeting.
          const full =
            currentDraft === undefined
              ? surface.composeMessage(
                  openWithSmsIdentification(
                    generated,
                    identificationFor(nextTone),
                  ),
                  footerCommittee,
                )
              : generated
          loadMessage(full)
          setOwnWords(currentDraft !== undefined)
          // Only fresh drafts are remembered per tone: a polish is of the
          // candidate's words, which a tone switch must not swap away.
          if (currentDraft === undefined) {
            setToneDrafts((prev) => ({ ...prev, [nextTone]: full }))
          }
        },
        // A first draft that fails leaves nothing to write into, so the
        // field gets the message's locked parts and the candidate writes
        // between them, as on the custom purpose.
        onError: () => {
          if (requestId !== draftRequestRef.current) return
          if (priorMessage.trim().length > 0) return
          loadMessage(surface.composeMessage('', footerCommittee))
        },
      },
    )
  }

  const handleSelectPurpose = (selected: SmsFlowPurpose) => {
    setPurpose(selected)
    setTone('warm')
    setManuallyEdited(false)
    setUndoText(null)
    // A custom message starts as its locked parts, written between.
    const start =
      selected === 'custom' ? surface.composeMessage('', footerCommittee) : ''
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
      setLockSource('')
      setOwnWords(false)
      setToneDrafts({})
      setUndoText(null)
      setManuallyEdited(false)
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
        requestDraft(purpose, nextTone, message, manuallyEdited, message)
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
      setManuallyEdited(false)
      return
    }
    requestDraft(purpose, nextTone, message, manuallyEdited)
  }

  const handleMessageChange = (value: string) => {
    seedUncheckedRef.current = null
    setMessage(value)
    setManuallyEdited(true)
    setOwnWords(true)
    if (draftMutation.isError) resetDraftMutation()
  }

  const aiAction = ownWords ? 'improve' : 'regenerate'
  const handleAiAction = () => {
    if (aiAction === 'regenerate') {
      requestDraft(purpose, tone, message, manuallyEdited)
      return
    }
    if (!hasWrittenBody) return
    requestDraft(purpose, tone, message, manuallyEdited, message)
  }

  const handleUndo = () => {
    if (undoText === null) return
    loadMessage(undoText)
    setUndoText(null)
    setManuallyEdited(true)
    setOwnWords(true)
  }

  // Name-step continue: create the list through the shared audience hook
  // (same endpoint the CRM wizard uses; the hook selects it and refreshes
  // both list caches), derive its phone list, and land on the schedule step —
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
      setPhoneList(null)
      setStopPolling(false)
      setPhoneListCreating(true)
      const result = await createP2pPhoneList(created, created.id)
      setPhoneListCreating(false)
      if (!result.ok || !result.token) {
        setPhoneListError(true)
        return
      }
      setPhoneListToken(result.token)
      setStepId('schedule')
    } catch {
      setPhoneListCreating(false)
      // audience.createListError renders the inline message below.
    }
  }

  // Recommendation flow: create the saved filter, derive its phone list,
  // and advance to schedule in one atomic gesture. Reached from the naming
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
    // list would let a retry skip straight to schedule with the wrong
    // audience.
    setPhoneListToken(null)
    setPhoneList(null)
    setStopPolling(false)
    setPhoneListError(false)
    setPhoneListCreating(true)
    const result = await createP2pPhoneList(created, created.id)
    setPhoneListCreating(false)
    if (!result.ok || !result.token) {
      setPhoneListError(true)
      return
    }
    setPhoneListToken(result.token)
    setStepId('schedule')
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
      setStepId('schedule')
      return
    }
    setPhoneListCreating(true)
    setPhoneListError(false)
    const result = await createP2pPhoneList(selectedList, selectedList.id)
    setPhoneListCreating(false)
    if (!result.ok || !result.token) {
      setPhoneListError(true)
      return
    }
    setPhoneListToken(result.token)
    setStepId('schedule')
  }

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
    const result = await createP2pPhoneList(selectedList, selectedList.id)
    setPhoneListCreating(false)
    if (!result.ok || !result.token) {
      setPhoneListError(true)
      return
    }
    setPhoneListToken(result.token)
    setStepId('review')
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
    if (!campaign?.id || !phoneList?.phoneListId || !scheduledAt) return
    isDraftCreatingRef.current = true
    setDraftCreateError(false)
    const generation = draftGenerationRef.current
    const discount = campaign?.hasFreeTextsOffer
      ? Math.min(phoneList.leadsLoaded, FREE_TEXTS_OFFER.COUNT)
      : 0
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
            phoneListId: phoneList.phoneListId,
            textCount: phoneList.leadsLoaded,
            billableTextCount: phoneList.leadsLoaded - discount,
            ...(campaignPlanDueDate ? { campaignPlanDueDate } : {}),
            // Resume: the server converts this row in place, so no second
            // row is written and the saved image and script stand.
            ...(resumed && savedDraft
              ? { draftOutreachId: savedDraft.id }
              : {}),
            draft: true,
          },
          resumed ? null : image,
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
                recipientCount: phoneList.leadsLoaded,
                sendDate: scheduledAt,
                outreachCampaignId: outreach.id,
                ...(audience.selectedListId !== null
                  ? { listId: audience.selectedListId }
                  : {}),
                audienceSource: audience.selectedRecommendation
                  ? 'recommended'
                  : 'savedList',
                ...(tracker ? { tracker } : {}),
              }),
            )
        } else {
          setDraftCreateError(true)
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
    scheduledAt,
    composedMessage,
    name,
    audience.selectedListId,
    image,
  ])

  const handleScheduled = async (paid: boolean) => {
    setPaidSend(paid)
    setScheduled(true)
    // A text campaign completes when it is bought and scheduled, not when
    // Peerly sends it — the send is hours or days later and nothing on the
    // client is alive to see it. `sendDate` carries that gap: it is the
    // scheduled day, never the event's own timestamp.
    const discount = campaign?.hasFreeTextsOffer
      ? Math.min(phoneList?.leadsLoaded ?? 0, FREE_TEXTS_OFFER.COUNT)
      : 0
    const billable = Math.max((phoneList?.leadsLoaded ?? 0) - discount, 0)
    trackEvent(EVENTS.Dashboard.VoterContact.CampaignCompleted, {
      ...outreachEventProps({
        channel: 'text',
        isServe: surface.isServe,
        campaignName: name.trim(),
        recipientCount: phoneList?.leadsLoaded ?? 0,
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
      setDraftCreateError(false)
    }
    const previous = stepOrder[stepIndex - 1]
    if (previous) setStepId(previous)
  }

  // A saved draft is the opposite of unsaved work: closing loses nothing.
  const dirty = !scheduled && purpose !== null && savedDraft === null

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
              audience.builderCapError,
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
                  reachableCount === 0,
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
                      setStepId('compose')
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
                      onClick: () =>
                        setStepId(buildMode ? 'schedule' : 'review'),
                      disabled:
                        !hasWrittenBody ||
                        !standards.passed ||
                        bracketsToFill.length > 0 ||
                        composedLength > SMS_COMPOSED_MAX_LENGTH ||
                        // Win only: Peerly rejects an imageless text/p2p send.
                        // Serve is fulfilled by the shared delivery layer, whose
                        // create takes imageUrl as optional, so an official can
                        // send text alone.
                        (!surface.isServe && image === null) ||
                        draftMutation.isPending,
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

  const cta: FlowShellCta | null =
    stepId === 'details' && !scheduled && !gateOpen
      ? {
          label: 'Continue',
          onClick: handleEventDetailsContinue,
          disabled: eventDetails.event === null,
        }
      : baseCta

  // Mirrors the review step's isFree: a free send reads "Review and send" /
  // "Schedule campaign" instead of the pay vocabulary (design prototype).
  const isFreeSend =
    Boolean(campaign?.hasFreeTextsOffer) &&
    (phoneList?.leadsLoaded ?? reachableCount ?? 0) <= FREE_TEXTS_OFFER.COUNT

  return (
    <OutreachFlowShell
      open={open}
      onClose={onClose}
      title={
        scheduled
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
        showGateChrome ? (
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
      onBack={
        // A resume has no reachable step behind it at all: purpose, audience
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
      {phoneListToken && !phoneList && (
        <LongPoll<PhoneListStatusResponse | false>
          pollingMethod={async () => getP2pPhoneListStatus(phoneListToken)}
          onSuccess={(result) => {
            if (result === undefined || result === false) {
              setStopPolling(true)
              return
            }
            setPhoneList(result)
            setStopPolling(true)
          }}
          stopPolling={stopPolling}
          limit={60}
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
          purposes={surface.purposes}
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
              setPhoneList(null)
              setStopPolling(false)
              setPhoneListError(false)
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
              setPhoneList(null)
              setStopPolling(false)
              setPhoneListError(false)
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
              setNameEdited(true)
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
                setNameEdited(true)
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
        <SmsComposeStep
          isServe={surface.isServe}
          tone={tone}
          onToneChange={handleToneChange}
          standardsFailures={standards.failures}
          unfilledBrackets={bracketsToFill}
          identificationExample={introFor(tone)}
          message={message}
          onMessageChange={handleMessageChange}
          protectedParts={protectedParts}
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
        />
      ) : (
        <CheckoutSessionProvider
          key={draftOutreachId ?? 'pending'}
          type={
            surface.isServe ? PURCHASE_TYPES.SERVE_TEXT : PURCHASE_TYPES.TEXT
          }
          purchaseMetaData={{
            contactCount: phoneList?.leadsLoaded ?? 0,
            pricePerContact: dollarsToCents(PRICE_PER_MESSAGE) || 0,
            outreachType: surface.isServe
              ? OUTREACH_TYPES.text
              : OUTREACH_TYPES.p2p,
            campaignId: campaign?.id,
            outreachId: draftOutreachId ?? undefined,
            phoneListToken: phoneListToken ?? undefined,
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
              buildMode ? reachableCount : (phoneList?.leadsLoaded ?? 0)
            }
            pricePerContact={PRICE_PER_MESSAGE}
            outreachId={draftOutreachId}
            phoneListToken={phoneListToken}
            excludedOptedOutCount={phoneList?.excludedOptedOutCount ?? null}
            excludedDuplicatePhoneCount={
              phoneList?.excludedDuplicatePhoneCount ?? null
            }
            preparing={
              !buildMode &&
              (!phoneList || (!draftOutreachId && !draftCreateError))
            }
            prepareError={draftCreateError}
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
