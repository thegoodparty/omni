'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { useMutation, useQuery } from '@tanstack/react-query'
import type {
  OutreachReceipt,
  RecommendedList,
  RecommendedListVariant,
  ServeSmsDraftRequest,
  SmsDraftRequest,
  SmsPurpose,
  SmsStandardsRule,
  SocialTone,
} from '@goodparty_org/contracts'
import type { TcrCompliance } from 'helpers/types'
import {
  checkSmsStandards,
  SMS_COMPOSED_MAX_LENGTH,
} from '@goodparty_org/contracts'
import { Button, Card } from '@styleguide'
import { CircleCheckIcon, DownloadIcon } from '@styleguide/components/ui/icons'
import { clientRequest } from 'gpApi/typed-request'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useUser } from '@shared/hooks/useUser'
import { LongPoll } from '@shared/utils/LongPoll'
import {
  createP2pPhoneList,
  getP2pPhoneListStatus,
  type PhoneListStatusResponse,
} from 'helpers/createP2pPhoneList'
import { createOutreach } from 'helpers/createOutreach'
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
  OutreachAudienceStep,
  type OutreachAudienceCopy,
} from '../audience/OutreachAudienceStep'
import {
  intentForOutreachPurpose,
  useOutreachAudience,
} from '../audience/useOutreachAudience'
import { purposeForRecommendedVariant } from '../audience/recommendedListMapping.util'
import {
  SERVE_SMS_PURPOSES,
  serveSmsPurposeNameSuggestion,
} from '../serveSmsPurposes'
import { SMS_PURPOSE_INTRO_BODY, SmsPurposeStep } from './SmsPurposeStep'
import { SmsScheduleStep, TIME_OPTIONS } from './SmsScheduleStep'
import { ServeSmsScheduleStep } from './ServeSmsScheduleStep'
import { SmsComposeStep } from './SmsComposeStep'
import { SmsReviewStep } from './SmsReviewStep'
import {
  composeScript,
  composeServeScript,
  identificationIntro,
  SMS_PURPOSES,
  type SmsFlowPurpose,
} from './smsCompose.util'
import {
  createServeSms,
  useServeSmsIdentification,
  useServeSmsSend,
  type ServeSmsCreateFn,
} from './useServeSmsSend'

type StepId = 'purpose' | 'audience' | 'schedule' | 'compose' | 'review'
const STEP_ORDER: StepId[] = [
  'purpose',
  'audience',
  'schedule',
  'compose',
  'review',
]

const STEP_TITLES: Record<StepId, string> = {
  purpose: 'What do you want to do?',
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
  // A message the candidate is meant to send as written (Know Your
  // Opponent). It opens the flow on `custom`, the one purpose that never
  // AI-drafts, so the seeded words are what they edit rather than something
  // a draft immediately overwrites.
  initialScript?: string
  preselectedListId?: number
  // `?recommended=` off the voter data page: a recommendation not saved yet,
  // which the audience step saves on arrival (see useOutreachAudience).
  preselectedRecommendedVariant?: RecommendedListVariant
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

// "visa" → "Visa" — Stripe reports card brands lowercase.
const cardBrandLabel = (brand: string) =>
  brand.charAt(0).toUpperCase() + brand.slice(1)

// Exported for its component test — the paid branch is unreachable through
// the flow in jsdom (CheckoutPayment mounts real Stripe elements).
export const SuccessScreen = ({
  contactCount,
  sendAt,
  outreachId,
  paid,
  onDone,
}: {
  contactCount: number
  sendAt: Date | null
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
            ? ` starting ${successDate(sendAt)} at ${successTime(sendAt)}.`
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
  initialScript,
  preselectedListId,
  preselectedRecommendedVariant,
}: SmsFlowProps) => {
  const [campaign] = useCampaign()
  const [user] = useUser()

  const [stepId, setStepId] = useState<StepId>('purpose')
  const [purpose, setPurpose] = useState<SmsFlowPurpose | null>(null)
  const [tone, setTone] = useState<SocialTone>('warm')
  const [body, setBody] = useState('')
  const [manuallyEdited, setManuallyEdited] = useState(false)
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

  // Reference equality against the Win singleton, not a purpose check:
  // recommended lists are Win-only (the endpoint 400s an eo- org outright),
  // and Serve's purpose vocabulary reuses three of the same slugs
  // (introduce_myself, event_invite, custom) for an unrelated, non-electoral
  // meaning, so the purpose string alone can't tell the two apart. Same
  // guard as PhoneBankingFlow.
  const isWinSms = surface === WIN_SMS_SURFACE
  const recommendedListIntent =
    isWinSms && purpose ? intentForOutreachPurpose(purpose as SmsPurpose) : null

  const audience = useOutreachAudience({
    open,
    active: stepId === 'audience',
    reachabilityKey: 'sms',
    countOverlay: SMS_COUNT_OVERLAY,
    recommendedListIntent,
    preselectedListId,
    preselectedRecommendedVariant,
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
    setStepId(initialScript || carriedPurpose ? 'audience' : 'purpose')
    setPurpose(initialScript ? 'custom' : carriedPurpose)
    setTone('warm')
    setBody(initialScript ?? '')
    setManuallyEdited(Boolean(initialScript))
    setUndoText(null)
    setToneDrafts({})
    resetAudience()
    setPhoneListToken(null)
    setPhoneListCreating(false)
    setPhoneListError(false)
    setStopPolling(false)
    setPhoneList(null)
    setName('')
    setNameEdited(false)
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
    initialScript,
    preselectedRecommendedVariant,
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
  const introFor = (t: SocialTone) =>
    surface.isServe
      ? serveIntroFor(t)
      : identificationIntro(
          t,
          candidateFirstName,
          campaign?.details?.normalizedOffice ?? '',
        )
  // Paid-for-by is a campaign-finance disclaimer naming a candidate
  // committee, which a Serve org does not have. Nulled at the source rather
  // than only inside composeMessage so the submitted script, the preview
  // bubble and checkSmsStandards cannot disagree about whether there is a
  // committee.
  const committeeName = surface.isServe
    ? null
    : (tcrCompliance?.committeeName ?? null)
  const composedMessage = surface.composeMessage(body, committeeName)
  const composedLength = composedMessage.length
  const rawStandards = checkSmsStandards(composedMessage, {
    candidateNames: [candidateFullName, tcrCompliance?.candidateName].filter(
      (name): name is string => !!name,
    ),
    committeeName,
  })
  // Win ignores nothing, so this is the raw verdict there.
  const standardsFailures = rawStandards.failures.filter(
    (rule) => !surface.ignoredStandardsRules.includes(rule),
  )
  const standards = {
    passed: standardsFailures.length === 0,
    failures: standardsFailures,
  }

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

  const scheduledAt = useMemo(() => {
    if (!date) return null
    if (fixedMorningSchedule) return date
    const slot = TIME_OPTIONS.find((t) => t.id === timeSlot)
    const timeStr = timeSlot === 'custom' ? customTime : slot?.time
    if (!timeStr) return null
    const [hh, mm] = timeStr.split(':').map(Number)
    if (hh === undefined || mm === undefined || Number.isNaN(hh)) return null
    const d = new Date(date)
    d.setHours(hh, mm, 0, 0)
    return d
  }, [date, timeSlot, customTime, fixedMorningSchedule])

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
  const outsideWindow =
    !fixedMorningSchedule && scheduledAt
      ? scheduledAt.getHours() < 9 ||
        scheduledAt.getHours() > 20 ||
        (scheduledAt.getHours() === 20 && scheduledAt.getMinutes() > 0)
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
    priorBody: string,
    priorManuallyEdited: boolean,
    currentDraft?: string,
  ) => {
    if (!nextPurpose) return
    if (nextPurpose === 'custom' && currentDraft === undefined) return
    const requestId = ++draftRequestRef.current
    draftMutation.mutate(
      {
        purpose: nextPurpose,
        tone: nextTone,
        ...(currentDraft === undefined ? {} : { currentDraft }),
      },
      {
        onSuccess: (generated) => {
          if (requestId !== draftRequestRef.current) return
          if (priorManuallyEdited) {
            setUndoText(priorBody)
            setManuallyEdited(false)
          }
          // Fresh drafts open with the identification (design model: it is
          // the message's editable first sentence); improve mode polishes a
          // message that already carries it.
          const full =
            currentDraft === undefined
              ? `${introFor(nextTone)} ${generated}`
              : generated
          setBody(full)
          setToneDrafts((prev) => ({ ...prev, [nextTone]: full }))
        },
      },
    )
  }

  const handleSelectPurpose = (selected: SmsFlowPurpose) => {
    setPurpose(selected)
    setTone('warm')
    setManuallyEdited(false)
    setUndoText(null)
    setBody('')
    setToneDrafts({})
    resetDraftMutation()
    setStepId('audience')
  }

  const handleToneChange = (nextTone: SocialTone) => {
    if (nextTone === tone) return
    if (!purpose || purpose === 'custom') {
      setTone(nextTone)
      return
    }
    // A blank body (first generation still in flight) must neither be
    // cached for the outgoing tone nor treated as a memory hit for the
    // incoming one — restoring '' would blank the editor and skip the fetch.
    const remembered = toneDrafts[nextTone]
    if (body.trim().length > 0) {
      setToneDrafts((prev) => ({ ...prev, [tone]: body }))
    }
    setTone(nextTone)
    if (remembered !== undefined && remembered.trim().length > 0) {
      draftRequestRef.current += 1
      resetDraftMutation()
      setBody(remembered)
      setManuallyEdited(false)
      return
    }
    requestDraft(purpose, nextTone, body, manuallyEdited)
  }

  const handleBodyChange = (value: string) => {
    setBody(value)
    setManuallyEdited(true)
    if (draftMutation.isError) resetDraftMutation()
  }

  const handleImprove = () => {
    if (body.trim().length === 0) return
    requestDraft(purpose, tone, body, manuallyEdited, body)
  }

  const handleUndo = () => {
    if (undoText === null) return
    setBody(undoText)
    setUndoText(null)
    setManuallyEdited(true)
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

  // First compose entry generates the initial draft (custom writes its own).
  useEffect(() => {
    if (stepId !== 'compose' || !open) return
    if (purpose === 'custom' || body.trim() || draftMutation.isPending) return
    requestDraft(purpose, tone, '', false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepId, open])

  // Draft-first purchase: entering review persists the campaign as a
  // pending_payment draft once the phone list is ready — the draft id gates
  // the checkout session (legacy TaskFlow sequence, relocated).
  useEffect(() => {
    if (surface.isServe) return
    if (stepId !== 'review' || !open || scheduled) return
    if (draftOutreachId || isDraftCreatingRef.current) return
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
            // Offset-annotated local time, not toISOString(): the server
            // slices the first 10 chars as the user's send DAY for Peerly,
            // and the UTC rendering puts evening sends on the next day.
            date: format(scheduledAt, "yyyy-MM-dd'T'HH:mm:ssXXX"),
            // The wall-clock time as picked — approve opens Peerly's
            // contact-local send window at it ("6 PM" means 6 PM wherever
            // the contact lives).
            scheduledLocalTime: format(scheduledAt, 'HH:mm'),
            ...(audience.selectedListId
              ? { voterFileFilterId: audience.selectedListId }
              : {}),
            phoneListId: phoneList.phoneListId,
            textCount: phoneList.leadsLoaded,
            billableTextCount: phoneList.leadsLoaded - discount,
            ...(campaignPlanDueDate ? { campaignPlanDueDate } : {}),
            draft: true,
          },
          image,
        )
        if (generation !== draftGenerationRef.current) return
        if (outreach?.id) {
          setDraftOutreachId(outreach.id)
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
    await onScheduled()
  }

  const stepIndex = STEP_ORDER.indexOf(stepId)

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
    if (stepId === 'review') {
      // Back off the pay step discards the draft (stale drafts stay hidden
      // server-side); re-entry creates a fresh one.
      draftGenerationRef.current += 1
      isDraftCreatingRef.current = false
      setDraftOutreachId(null)
      setDraftCreateError(false)
    }
    const previous = STEP_ORDER[stepIndex - 1]
    if (previous) setStepId(previous)
  }

  const dirty = !scheduled && purpose !== null

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
          : stepId === 'schedule'
            ? {
                label: 'Continue',
                onClick: () => setStepId('compose'),
                disabled:
                  name.trim().length === 0 ||
                  scheduledAt === null ||
                  violates48h ||
                  outsideWindow,
              }
            : stepId === 'compose'
              ? {
                  label: 'Continue',
                  onClick: () => setStepId('review'),
                  disabled:
                    body.trim().length === 0 ||
                    !standards.passed ||
                    composedLength > SMS_COMPOSED_MAX_LENGTH ||
                    // Win only: Peerly rejects an imageless text/p2p send.
                    // Serve is fulfilled by the shared delivery layer, whose
                    // create takes imageUrl as optional, so an official can
                    // send text alone.
                    (!surface.isServe && image === null) ||
                    draftMutation.isPending,
                }
              : null

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
          : stepId === 'review' && isFreeSend
            ? 'Review and send'
            : STEP_TITLES[stepId]
      }
      headerBadge={<ChannelBadge type={OUTREACH_TYPES.text} />}
      currentStep={stepIndex + 1}
      totalSteps={scheduled ? 0 : STEP_ORDER.length}
      onBack={!scheduled && stepIndex > 0 ? handleBack : undefined}
      cta={cta}
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
      {scheduled ? (
        <SuccessScreen
          contactCount={phoneList?.leadsLoaded ?? reachableCount ?? 0}
          sendAt={scheduledAt}
          outreachId={draftOutreachId}
          paid={paidSend}
          onDone={onClose}
        />
      ) : stepId === 'purpose' ? (
        <SmsPurposeStep
          selected={purpose}
          onSelect={handleSelectPurpose}
          purposes={surface.purposes}
          introBody={surface.purposeIntroBody}
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
          <SmsScheduleStep
            name={name}
            onNameChange={(value) => {
              setName(value)
              setNameEdited(true)
            }}
            date={date}
            onDateChange={setDate}
            timeSlot={timeSlot}
            onTimeSlotChange={setTimeSlot}
            customTime={customTime}
            onCustomTimeChange={setCustomTime}
            earliestSend={earliestSend}
            calendarFloor={earliestSend}
            violates48h={violates48h}
            outsideWindow={outsideWindow}
          />
        )
      ) : stepId === 'compose' ? (
        <SmsComposeStep
          isServe={surface.isServe}
          tone={tone}
          onToneChange={handleToneChange}
          audienceName={selectedList?.name ?? audience.builderName}
          standardsFailures={standards.failures}
          identificationExample={introFor(tone)}
          committeeName={committeeName}
          body={body}
          onBodyChange={handleBodyChange}
          composedLength={composedLength}
          onRegenerate={() => requestDraft(purpose, tone, body, manuallyEdited)}
          onImprove={handleImprove}
          canImprove={manuallyEdited && body.trim().length > 0}
          isDrafting={draftMutation.isPending}
          isDraftError={draftMutation.isError}
          canUndo={undoText !== null}
          onUndo={handleUndo}
          isCustomPurpose={purpose === 'custom'}
          image={image}
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
            composedMessage={composedMessage}
            imagePreviewUrl={imagePreviewUrl}
            contactCount={phoneList?.leadsLoaded ?? 0}
            pricePerContact={PRICE_PER_MESSAGE}
            outreachId={draftOutreachId}
            phoneListToken={phoneListToken}
            excludedOptedOutCount={phoneList?.excludedOptedOutCount ?? null}
            excludedDuplicatePhoneCount={
              phoneList?.excludedDuplicatePhoneCount ?? null
            }
            preparing={!phoneList || (!draftOutreachId && !draftCreateError)}
            prepareError={draftCreateError}
            onComplete={handleScheduled}
          />
        </CheckoutSessionProvider>
      )}
    </OutreachFlowShell>
  )
}
