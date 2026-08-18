'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  SmsDraftRequest,
  SmsPurpose,
  SocialTone,
} from '@goodparty_org/contracts'
import { SMS_COMPOSED_MAX_LENGTH } from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import { CheckCircleIcon } from '@styleguide/components/ui/icons'
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
import { fetchListDetail } from 'app/dashboard/contacts/crm/lists/useListRowDetail'
import { AUTO_VOTER_FILTER_NAME_PATTERN } from 'app/dashboard/components/tasks/flows/util/flowHandlers.util'
import { CheckoutSessionProvider } from 'app/dashboard/purchase/components/CheckoutSessionProvider'
import {
  OUTREACH_TYPES,
  FREE_TEXTS_OFFER,
} from 'app/dashboard/outreach/constants'
import { OUTREACH_OPTIONS } from 'app/dashboard/outreach/components/OutreachCreateCards'
import { PURCHASE_TYPES } from 'helpers/purchaseTypes'
import { dollarsToCents } from 'helpers/numberHelper'
import type {
  SegmentResponse,
  SupportStatusRollup,
} from 'app/dashboard/contacts/crm/shared/contacts-types'
import {
  hasAnyVoterFileSelection,
  transformVoterFileFiltersForBackend,
  type VoterFileFilters,
} from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import { useListWizardCount } from 'app/dashboard/contacts/crm/wizard/useListWizardCount'
import { OutreachFlowShell, type FlowShellCta } from '../OutreachFlowShell'
import { SmsPurposeStep } from './SmsPurposeStep'
import { SmsAudienceStep, type SmsAudienceMode } from './SmsAudienceStep'
import { SmsScheduleStep, TIME_OPTIONS } from './SmsScheduleStep'
import { SmsComposeStep } from './SmsComposeStep'
import { SmsReviewStep } from './SmsReviewStep'
import { composeScript, identificationIntro } from './smsCompose.util'

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
  review: 'Review and send',
}

const PRICE_PER_MESSAGE =
  OUTREACH_OPTIONS.find((o) => o.type === OUTREACH_TYPES.text)?.cost ?? 0.035

interface SmsFlowProps {
  open: boolean
  onClose: () => void
  // Fired after payment (or free redemption) completes server-side; the hub
  // refetches the outreach list there.
  onScheduled: () => Promise<void>
}

const SuccessScreen = ({
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
        <CheckCircleIcon className="size-8 text-primary" />
      </span>
    </div>
    <div className="space-y-2">
      <h2 className="text-2xl font-semibold text-foreground">
        Payment successful!
      </h2>
      <p className="text-muted-foreground">
        Your text campaign has been scheduled and will reach{' '}
        {contactCount.toLocaleString()} recipients
        {sendAt
          ? ` on ${sendAt.toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })}.`
          : ' soon.'}
      </p>
    </div>
    <Button size="large" className="w-full" onClick={onDone}>
      Done
    </Button>
  </div>
)

// Flow state is flat client state owned here (phase 1 shell convention):
// nothing persists until the pay step's draft-first create, and reopening
// starts fresh.
export const SmsFlow = ({ open, onClose, onScheduled }: SmsFlowProps) => {
  const [campaign] = useCampaign()
  const [user] = useUser()

  const [stepId, setStepId] = useState<StepId>('purpose')
  const [purpose, setPurpose] = useState<SmsPurpose | null>(null)
  const [tone, setTone] = useState<SocialTone>('warm')
  const [body, setBody] = useState('')
  const [manuallyEdited, setManuallyEdited] = useState(false)
  const [undoText, setUndoText] = useState<string | null>(null)
  const [toneDrafts, setToneDrafts] = useState<
    Partial<Record<SocialTone, string>>
  >({})

  const [selectedListId, setSelectedListId] = useState<number | null>(null)
  const [audienceMode, setAudienceMode] = useState<SmsAudienceMode>('picker')
  const [builderFilters, setBuilderFilters] = useState<VoterFileFilters>({})
  const [builderSupportStatus, setBuilderSupportStatus] = useState<
    SupportStatusRollup[]
  >([])
  const [builderName, setBuilderName] = useState('')
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

  const draftRequestRef = useRef(0)

  const listsQuery = useQuery({
    queryKey: ['sms-flow-saved-lists'],
    queryFn: async () => {
      const { data } = await clientRequest(
        'GET /v1/voters/voter-file/filters',
        {},
      )
      return (data ?? []).filter(
        (list): list is SegmentResponse =>
          typeof list?.name === 'string' &&
          !AUTO_VOTER_FILTER_NAME_PATTERN.test(list.name),
      )
    },
    enabled: open,
    // A list created in the CRM tab (the picker's interim create path) must
    // appear when the user returns — bypass the app's 5-minute staleTime.
    staleTime: 0,
    refetchOnWindowFocus: true,
  })
  const lists = useMemo(() => listsQuery.data ?? [], [listsQuery.data])
  const selectedList = lists.find((l) => l.id === selectedListId) ?? null

  const reachabilityQuery = useQuery({
    queryKey: ['sms-flow-list-reachability', selectedListId],
    queryFn: async () => {
      const detail = await fetchListDetail(selectedListId as number)
      return detail.reachability.sms as number | null
    },
    enabled: open && selectedListId !== null,
  })
  const reachableCount = reachabilityQuery.data ?? null

  const queryClient = useQueryClient()

  const builderPayload = useMemo(
    () => ({
      ...transformVoterFileFiltersForBackend(builderFilters),
      ...(builderSupportStatus.length
        ? { supportStatus: builderSupportStatus }
        : {}),
    }),
    [builderFilters, builderSupportStatus],
  )
  const builderCountResult = useListWizardCount(
    builderPayload,
    open && stepId === 'audience' && audienceMode !== 'picker',
  )
  const builderCounting =
    builderCountResult.isLoading ||
    builderCountResult.isStale ||
    builderCountResult.count === undefined
  // Mirrors the CRM wizard's settled-zero gate: only a settled zero blocks.
  const builderZeroMatch =
    !builderCountResult.isLoading &&
    !builderCountResult.isStale &&
    !builderCountResult.isError &&
    builderCountResult.count === 0

  const createListMutation = useMutation({
    mutationFn: async () => {
      const { data } = await clientRequest(
        'POST /v1/voters/voter-file/filter',
        {
          name: builderName.trim(),
          ...builderPayload,
        },
      )
      return data
    },
  })

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
    setSelectedListId(null)
    setAudienceMode('picker')
    setBuilderFilters({})
    setBuilderSupportStatus([])
    setBuilderName('')
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
    resetDraftMutation()
  }, [open, resetDraftMutation])

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

  const intro = identificationIntro(
    tone,
    user?.firstName ?? '',
    campaign?.details?.normalizedOffice ?? '',
  )
  const composedMessage = composeScript(intro, body)
  const composedLength = composedMessage.length

  const earliestSend = useMemo(() => Date.now() + 48 * 60 * 60 * 1000, [open])

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
          setBody(generated)
          setToneDrafts((prev) => ({ ...prev, [nextTone]: generated }))
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

  const resetBuilder = () => {
    setAudienceMode('picker')
    setBuilderFilters({})
    setBuilderSupportStatus([])
    setBuilderName('')
    createListMutation.reset()
  }

  // Name-step continue: create the list (the same endpoint the CRM wizard
  // uses), select it, derive its phone list, and land on the schedule step —
  // the prototype's build-and-keep-going path.
  const handleCreateListContinue = async () => {
    if (builderName.trim().length === 0 || createListMutation.isPending) return
    setPhoneListError(false)
    try {
      const created = await createListMutation.mutateAsync()
      await queryClient.invalidateQueries({
        queryKey: ['sms-flow-saved-lists'],
      })
      setSelectedListId(created.id)
      setPhoneList(null)
      setStopPolling(false)
      setPhoneListCreating(true)
      const result = await createP2pPhoneList(created, created.id)
      setPhoneListCreating(false)
      if (!result.ok || !result.token) {
        setPhoneListError(true)
        resetBuilder()
        return
      }
      setPhoneListToken(result.token)
      resetBuilder()
      setStepId('schedule')
    } catch {
      setPhoneListCreating(false)
      // createListMutation.isError renders the inline message below.
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
            ...(selectedListId ? { voterFileFilterId: selectedListId } : {}),
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
    selectedListId,
    image,
  ])

  const handleScheduled = async () => {
    setScheduled(true)
    await onScheduled()
  }

  const stepIndex = STEP_ORDER.indexOf(stepId)

  const handleBack = () => {
    if (stepId === 'audience' && audienceMode === 'name') {
      setAudienceMode('filters')
      return
    }
    if (stepId === 'audience' && audienceMode === 'filters') {
      resetBuilder()
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
    : stepId === 'audience' && audienceMode === 'filters'
      ? {
          label: builderCounting
            ? 'Continue'
            : `Continue (${(builderCountResult.count ?? 0).toLocaleString()})`,
          onClick: () => setAudienceMode('name'),
          disabled:
            !hasAnyVoterFileSelection(builderFilters, builderSupportStatus) ||
            builderCounting ||
            builderZeroMatch ||
            builderCountResult.isCapError,
          loading:
            hasAnyVoterFileSelection(builderFilters, builderSupportStatus) &&
            builderCounting,
        }
      : stepId === 'audience' && audienceMode === 'name'
        ? {
            label: 'Continue',
            onClick: () => {
              void handleCreateListContinue()
            },
            disabled: builderName.trim().length === 0,
            loading: createListMutation.isPending || phoneListCreating,
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
                reachabilityQuery.isLoading ||
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
      {scheduled ? (
        <SuccessScreen
          contactCount={phoneList?.leadsLoaded ?? reachableCount ?? 0}
          sendAt={scheduledAt}
          onDone={onClose}
        />
      ) : stepId === 'purpose' ? (
        <SmsPurposeStep selected={purpose} onSelect={handleSelectPurpose} />
      ) : stepId === 'audience' ? (
        <>
          <SmsAudienceStep
            mode={audienceMode}
            lists={lists}
            listsLoading={listsQuery.isLoading}
            selectedId={selectedListId}
            onSelect={(id) => {
              setSelectedListId(id)
              // A different audience needs a fresh phone list.
              setPhoneListToken(null)
              setPhoneList(null)
              setStopPolling(false)
            }}
            onStartBuilder={() => setAudienceMode('filters')}
            reachableCount={reachableCount}
            reachableLoading={reachabilityQuery.isLoading}
            pricePerMessage={PRICE_PER_MESSAGE}
            builderFilters={builderFilters}
            onBuilderFiltersChange={setBuilderFilters}
            builderSupportStatus={builderSupportStatus}
            onBuilderSupportStatusChange={setBuilderSupportStatus}
            builderName={builderName}
            onBuilderNameChange={setBuilderName}
            builderCount={builderCountResult.count}
            builderCounting={builderCounting}
            builderCapError={builderCountResult.isCapError}
            builderCountErrorMessage={builderCountResult.errorMessage}
          />
          {createListMutation.isError && (
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
          violates48h={violates48h}
          outsideWindow={outsideWindow}
        />
      ) : stepId === 'compose' ? (
        <SmsComposeStep
          tone={tone}
          onToneChange={handleToneChange}
          intro={intro}
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
