'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery } from '@tanstack/react-query'
import type {
  OutreachReceipt,
  SmsDraftRequest,
  SmsPurpose,
  SocialTone,
} from '@goodparty_org/contracts'
import { SMS_COMPOSED_MAX_LENGTH } from '@goodparty_org/contracts'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
} from '@styleguide'
import {
  BookmarkIcon,
  CheckCircleIcon,
  ClipboardListIcon,
  ClockIcon,
  DownloadIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
} from '@styleguide/components/ui/icons'
import { clientRequest } from 'gpApi/typed-request'
import { PeerlyCvVerificationStatus } from '@goodparty_org/contracts'
import type { TcrCompliance } from 'helpers/types'
import {
  ELECTION_FILING_PATH,
  SUBMIT_PIN_PATH,
} from 'app/dashboard/shared/ComplianceModal'
import { TCR_COMPLIANCE_STATUS } from 'app/dashboard/profile/texting-compliance/util/tcrCompliance.util'
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
  OUTREACH_TYPES,
  FREE_TEXTS_OFFER,
} from 'app/dashboard/outreach/constants'
import { OUTREACH_OPTIONS } from 'app/dashboard/outreach/components/OutreachCreateCards'
import { PURCHASE_TYPES } from 'helpers/purchaseTypes'
import { dollarsToCents } from 'helpers/numberHelper'
import { hasAnyVoterFileSelection } from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import { OutreachFlowShell, type FlowShellCta } from '../OutreachFlowShell'
import {
  OutreachAudienceStep,
  type OutreachAudienceCopy,
} from '../audience/OutreachAudienceStep'
import { useOutreachAudience } from '../audience/useOutreachAudience'
import { SmsPurposeStep } from './SmsPurposeStep'
import { SmsScheduleStep, TIME_OPTIONS } from './SmsScheduleStep'
import { SmsComposeStep } from './SmsComposeStep'
import { SmsReviewStep } from './SmsReviewStep'
import {
  composeScript,
  hasIdentification,
  identificationIntro,
} from './smsCompose.util'

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
  audience: 'Who are you texting?',
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

const SMS_AUDIENCE_COPY: OutreachAudienceCopy = {
  pickerTitle: 'Who do you want to reach?',
  pickerBody:
    'Pick one of your saved voter lists. We only text voters with a mobile number.',
  filtersTitle: 'Build a voter list',
  filtersBody: 'Pick filters to define who this campaign reaches.',
  nameTitle: 'Name your list',
  nameBody: 'You can rename it any time.',
  reachVerb: 'Message',
  reachNoun: 'voters',
  unitCostLabel: 'Each message costs',
}

interface SmsFlowProps {
  open: boolean
  onClose: () => void
  tcrCompliance?: TcrCompliance
  // Fired after payment (or free redemption) completes server-side; the hub
  // refetches the outreach list there.
  onScheduled: () => Promise<void>
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
          <CheckCircleIcon className="size-8 text-primary" />
        </span>
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl font-semibold text-foreground">
          Payment successful!
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

const VerificationRow = ({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode
  title: string
  body: string
}) => (
  <div className="flex items-start gap-3">
    <span className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:size-4">
      {icon}
    </span>
    <span>
      <span className="block text-sm font-semibold text-foreground">
        {title}
      </span>
      <span className="block text-sm text-muted-foreground">{body}</span>
    </span>
  </div>
)

// Post-success interstitial (shown only while CampaignVerify clearance is
// pending): the send is saved but held by the carriers, so the one useful
// next action is starting verification.
const VerificationInterstitial = ({
  onLater,
  onStartVerification,
}: {
  onLater: () => void
  onStartVerification: () => void
}) => (
  <div className="space-y-6 py-8">
    <Badge
      shape="pill"
      className="border-transparent bg-info-light text-foreground"
    >
      Verification
    </Badge>
    <div className="space-y-2">
      <h2 className="text-2xl font-semibold text-foreground">
        One more step before this can send
      </h2>
      <p className="text-muted-foreground">
        Your text is saved and scheduled, but it will not go out until your
        campaign is verified with the carriers.
      </p>
    </div>
    <Card className="gap-4 p-4">
      <VerificationRow
        icon={<ClipboardListIcon />}
        title="What we need"
        body="Your candidacy, your campaign EIN and your filing details"
      />
      <VerificationRow
        icon={<ClockIcon />}
        title="How long it takes"
        body="About 1 to 2 weeks for the carriers to clear your campaign"
      />
      <VerificationRow
        icon={<BookmarkIcon />}
        title="Nothing is lost"
        body="Your text stays saved and scheduled while this is under review"
      />
    </Card>
    <Alert variant="info">
      <AlertTitle>Start now if you can</AlertTitle>
      <AlertDescription>
        Verification runs in the background, so starting today keeps your send
        date safe.
      </AlertDescription>
    </Alert>
    <div className="flex items-center gap-3">
      <Button type="button" variant="ghost" onClick={onLater}>
        Later
      </Button>
      <Button type="button" className="flex-1" onClick={onStartVerification}>
        Start verification
      </Button>
    </div>
  </div>
)

// Flow state is flat client state owned here (phase 1 shell convention):
// nothing persists until the pay step's draft-first create, and reopening
// starts fresh.
export const SmsFlow = ({
  open,
  onClose,
  tcrCompliance,
  onScheduled,
}: SmsFlowProps) => {
  const [campaign] = useCampaign()
  const [user] = useUser()
  const router = useRouter()

  const [stepId, setStepId] = useState<StepId>('purpose')
  const [purpose, setPurpose] = useState<SmsPurpose | null>(null)
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
  const [scheduled, setScheduled] = useState(false)
  const [paidSend, setPaidSend] = useState(false)
  const [showVerify, setShowVerify] = useState(false)

  const draftRequestRef = useRef(0)

  const audience = useOutreachAudience({
    open,
    active: stepId === 'audience',
    reachabilityKey: 'sms',
    countOverlay: SMS_COUNT_OVERLAY,
  })
  const { reset: resetAudience } = audience
  const selectedList = audience.selectedList
  const reachableCount = audience.reachableCount

  const draftMutation = useMutation({
    mutationFn: async (input: SmsDraftRequest) => {
      const { data } = await clientRequest('POST /v1/outreach/sms/draft', input)
      return data.draft
    },
  })
  const { reset: resetDraftMutation } = draftMutation

  useEffect(() => {
    if (!open) return
    draftRequestRef.current += 1
    setStepId('purpose')
    setPurpose(null)
    setTone('warm')
    setBody('')
    setManuallyEdited(false)
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
    setShowVerify(false)
    resetDraftMutation()
  }, [open, resetDraftMutation, resetAudience])

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

  const introFor = (t: SocialTone) =>
    identificationIntro(
      t,
      user?.firstName ?? '',
      campaign?.details?.normalizedOffice ?? '',
    )
  const composedMessage = composeScript(body)
  const composedLength = composedMessage.length
  const missingIdentification = !hasIdentification(body, user?.firstName ?? '')

  // The design's flowEarliest: while identity verification is pending
  // (CampaignVerify not VERIFIED), the earliest send moves from 48 hours to
  // 14 days out so verification has time to clear before the job runs; the
  // review step's not-cleared banner covers the case where it still hasn't.
  const notCleared =
    tcrCompliance?.peerlyCvStatus !== PeerlyCvVerificationStatus.VERIFIED
  // Validation floor: 14 days while verification pends, else 48h. The
  // CALENDAR only ever blocks the hard 48h window — dates inside the
  // compliance window stay selectable and surface the explanatory alert
  // instead (design parity).
  const earliestSend = useMemo(
    () =>
      Date.now() +
      (notCleared ? 14 * 24 * 60 * 60 * 1000 : 48 * 60 * 60 * 1000),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute on
    // each open, like the fresh-state reset
    [open, notCleared],
  )

  const scheduledAt = useMemo(() => {
    if (!date) return null
    const slot = TIME_OPTIONS.find((t) => t.id === timeSlot)
    const timeStr = timeSlot === 'custom' ? customTime : slot?.time
    if (!timeStr) return null
    const [hh, mm] = timeStr.split(':').map(Number)
    if (hh === undefined || mm === undefined || Number.isNaN(hh)) return null
    const d = new Date(date)
    d.setHours(hh, mm, 0, 0)
    return d
  }, [date, timeSlot, customTime])

  const violates48h = scheduledAt ? scheduledAt.getTime() < earliestSend : false
  const outsideWindow = scheduledAt
    ? scheduledAt.getHours() < 9 ||
      scheduledAt.getHours() > 21 ||
      (scheduledAt.getHours() === 21 && scheduledAt.getMinutes() > 0)
    : false

  // Auto-name from list + date until the user edits the name.
  const lastAutoName = useRef('')
  useEffect(() => {
    if (nameEdited) return
    const listPart = selectedList?.name ?? 'Text campaign'
    const datePart = date
      ? `, ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      : ''
    const auto = `${listPart} — SMS${datePart}`
    if (name === '' || name === lastAutoName.current) {
      setName(auto)
      lastAutoName.current = auto
    }
  }, [selectedList, date, name, nameEdited])

  const requestDraft = (
    nextPurpose: SmsPurpose | null,
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

  const handleSelectPurpose = (selected: SmsPurpose) => {
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
    if (audience.builderName.trim().length === 0 || audience.createListPending)
      return
    setPhoneListError(false)
    try {
      const created = await audience.createList()
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

  // Audience advance: derive the Peerly phone list from the saved filter.
  // The status poll runs across the later steps; the pay step waits on it.
  const handleAudienceContinue = async () => {
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
    if (stepId !== 'review' || !open || scheduled) return
    if (draftOutreachId || isDraftCreatingRef.current) return
    if (!campaign?.id || !phoneList?.phoneListId || !scheduledAt) return
    isDraftCreatingRef.current = true
    setDraftCreateError(false)
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
            date: scheduledAt.toISOString(),
            ...(audience.selectedListId
              ? { voterFileFilterId: audience.selectedListId }
              : {}),
            phoneListId: phoneList.phoneListId,
            textCount: phoneList.leadsLoaded,
            billableTextCount: phoneList.leadsLoaded - discount,
            draft: true,
          },
          image,
        )
        if (outreach?.id) {
          setDraftOutreachId(outreach.id)
        } else {
          setDraftCreateError(true)
        }
      } finally {
        isDraftCreatingRef.current = false
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

  // ComplianceModal's status-aware target: a SUBMITTED registration is
  // waiting on the CampaignVerify PIN; anything else (typically no record)
  // enters at the election-filing form.
  const startVerification = () => {
    router.push(
      tcrCompliance?.status === TCR_COMPLIANCE_STATUS.SUBMITTED
        ? SUBMIT_PIN_PATH
        : ELECTION_FILING_PATH,
    )
    onClose()
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
            ) ||
            audience.builderCounting ||
            audience.builderZeroMatch ||
            audience.builderCapError,
          loading:
            hasAnyVoterFileSelection(
              audience.builderFilters,
              audience.builderSupportStatus,
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
                void handleAudienceContinue()
              },
              disabled:
                !selectedList ||
                audience.reachableLoading ||
                reachableCount === null ||
                reachableCount === 0,
              loading: phoneListCreating,
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
                    missingIdentification ||
                    composedLength > SMS_COMPOSED_MAX_LENGTH ||
                    image === null ||
                    draftMutation.isPending,
                }
              : null

  return (
    <OutreachFlowShell
      open={open}
      onClose={onClose}
      title={scheduled ? 'Done' : STEP_TITLES[stepId]}
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
      {!scheduled && notCleared && (
        // Persistent while CampaignVerify clearance pends: every step opens
        // with the design's compliance call-to-action so the user can start
        // verification before the scheduled send needs it.
        <Alert variant="info" icon={<ShieldAlertIcon />} className="mb-6">
          <AlertTitle>Compliance needed before this can send</AlertTitle>
          <AlertDescription>
            Carrier approval takes 1 to 2 weeks. Schedule now, start compliance
            so your text clears in time.
          </AlertDescription>
          <AlertAction>
            <Button
              type="button"
              variant="alertOutline"
              onClick={startVerification}
            >
              <ShieldCheckIcon />
              Start compliance
            </Button>
          </AlertAction>
        </Alert>
      )}
      {scheduled && showVerify ? (
        <VerificationInterstitial
          onLater={onClose}
          onStartVerification={startVerification}
        />
      ) : scheduled ? (
        <SuccessScreen
          contactCount={phoneList?.leadsLoaded ?? reachableCount ?? 0}
          sendAt={scheduledAt}
          outreachId={draftOutreachId}
          paid={paidSend}
          onDone={notCleared ? () => setShowVerify(true) : onClose}
        />
      ) : stepId === 'purpose' ? (
        <SmsPurposeStep selected={purpose} onSelect={handleSelectPurpose} />
      ) : stepId === 'audience' ? (
        <>
          <OutreachAudienceStep
            channel="text"
            copy={SMS_AUDIENCE_COPY}
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
            reachableCount={reachableCount}
            reachableLoading={audience.reachableLoading}
            pricePerContact={PRICE_PER_MESSAGE}
            builderFilters={audience.builderFilters}
            onBuilderFiltersChange={audience.setBuilderFilters}
            builderSupportStatus={audience.builderSupportStatus}
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
        <SmsScheduleStep
          name={name}
          notCleared={notCleared}
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
          calendarFloor={
            earliestSend - (notCleared ? 12 * 24 * 60 * 60 * 1000 : 0)
          }
          violates48h={violates48h}
          outsideWindow={outsideWindow}
        />
      ) : stepId === 'compose' ? (
        <SmsComposeStep
          tone={tone}
          onToneChange={handleToneChange}
          audienceName={selectedList?.name ?? audience.builderName}
          missingIdentification={missingIdentification}
          identificationExample={introFor(tone)}
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
          type={PURCHASE_TYPES.TEXT}
          purchaseMetaData={{
            contactCount: phoneList?.leadsLoaded ?? 0,
            pricePerContact: dollarsToCents(PRICE_PER_MESSAGE) || 0,
            outreachType: OUTREACH_TYPES.p2p,
            campaignId: campaign?.id,
            outreachId: draftOutreachId ?? undefined,
            phoneListToken: phoneListToken ?? undefined,
          }}
        >
          <SmsReviewStep
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
