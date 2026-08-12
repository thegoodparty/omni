'use client'
import Modal from '@shared/utils/Modal'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { IoArrowForward } from 'react-icons/io5'
import InstructionsStep from './InstructionsStep'
import AudienceStep, { type AudienceSource } from './AudienceStep'
import AddScriptStep from './AddScriptStep/AddScriptStep'
import ScheduleStep from './ScheduleStep'
import ImageStep from './ImageStep'
import DownloadStep from './DownloadStep'
import SocialPostStep from './SocialPostStep'
import CloseConfirmModal from './CloseConfirmModal'
import { buildTrackingAttrs, EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { isObjectEqual } from 'helpers/objectHelper'
import { STEPS } from '../../../shared/constants/tasks.const'
import sanitizeHtml from 'sanitize-html'
import { useOutreach } from 'app/dashboard/outreach/hooks/OutreachContext'
import { useSnackbar } from 'helpers/useSnackbar'
import { getVoterContactField } from '@shared/hooks/VoterContactsProvider'
import { useVoterContacts } from '@shared/hooks/useVoterContacts'
import {
  handleCreateOutreach,
  handleCreatePhoneList,
  handleCreateVoterFileFilter,
  FlowState,
  AudienceState,
} from 'app/dashboard/components/tasks/flows/util/flowHandlers.util'
import { OUTREACH_OPTIONS } from 'app/dashboard/outreach/components/OutreachCreateCards'
import { CheckoutSessionProvider } from 'app/dashboard/purchase/components/CheckoutSessionProvider'
import { PURCHASE_TYPES } from 'helpers/purchaseTypes'
import { dollarsToCents } from 'helpers/numberHelper'
import { PurchaseStep } from 'app/dashboard/components/tasks/flows/PurchaseStep'
import { LongPoll } from '@shared/utils/LongPoll'
import {
  getP2pPhoneListStatus,
  PhoneListStatusResponse,
} from 'helpers/createP2pPhoneList'
import { getFlowStepsByType } from 'app/dashboard/components/tasks/flows/util/getFlowStepsByType.util'
import { getEffectiveOutreachType } from 'app/dashboard/outreach/util/getEffectiveOutreachType'
import { Campaign } from 'helpers/types'
import { OutreachType } from 'gpApi/types/outreach.types'
import { useQueryClient } from '@tanstack/react-query'
import { CAMPAIGN_QUERY_KEY } from '@shared/hooks/CampaignProvider'
import { clientRequest } from 'gpApi/typed-request'
import { LoadingAnimation } from '@shared/utils/LoadingAnimation'

interface TaskFlowState extends FlowState {
  step: number
  budget: number
  voicemail?: boolean
  audience: AudienceState
  script: string | false | null
  scriptText: string
  voterCount: number
  phoneListToken: string | null
  leadsLoaded: number | null
  // ENG-10808: from the phone-list status poll's capture-row fields
  // (ENG-10800/ENG-10801) — surfaced on the purchase review alongside
  // leadsLoaded so a user can see why it's smaller than their list.
  excludedOptedOutCount: number | null
  excludedDuplicatePhoneCount: number | null
  // ENG-10765: distinguishes a saved-list selection from a throwaway
  // checkbox-built filter (both carry an `id` on voterFileFilter) so
  // DownloadStep knows to hit the segment export instead of the checkbox
  // voter-file download.
  savedListId: number | null
  // ENG-10767: how the audience was chosen, reported by AudienceStep on
  // advance and carried onto the Campaign Completed events so a campaign is
  // attributable to the CRM list → outreach funnel.
  audienceSource: AudienceSource | null
  audienceListId: number | null
}

const DEFAULT_STATE: TaskFlowState = {
  step: 0,
  budget: 0,
  voicemail: undefined,
  audience: {},
  script: false,
  scriptText: '',
  image: undefined,
  voterCount: 0,
  voterFileFilter: null,
  phoneListToken: '',
  phoneListId: null,
  leadsLoaded: null,
  excludedOptedOutCount: null,
  excludedDuplicatePhoneCount: null,
  savedListId: null,
  audienceSource: null,
  audienceListId: null,
}

type TaskFlowProps = {
  type: OutreachType
  customButton?: ReactElement
  campaign: Campaign
  isCustom?: boolean
  forceOpen?: boolean
  onClose?: () => void
  onComplete?: () => void | Promise<void>
  defaultAiTemplateId?: string | number
  campaignPlanDueDate?: string
  initialScriptText?: string
  preselectedListId?: number
}

const TaskFlow = ({
  forceOpen = false,
  type,
  customButton,
  campaign,
  isCustom,
  onClose,
  onComplete,
  defaultAiTemplateId,
  campaignPlanDueDate,
  initialScriptText,
  preselectedListId,
}: TaskFlowProps): React.JSX.Element => {
  const [open, setOpen] = useState(forceOpen)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [state, setState] = useState(DEFAULT_STATE)
  const stepList = useMemo(getFlowStepsByType(type), [type]) || []
  const stepName = stepList[state.step]
  const isLastStep = state.step >= stepList.length - 1
  const [outreaches, setOutreaches] = useOutreach()
  const { errorSnackbar, successSnackbar } = useSnackbar()
  const [, updateVoterContacts] = useVoterContacts()
  const outreachOption = OUTREACH_OPTIONS.find(
    (outreach) => outreach.type === type,
  )
  const {
    phoneListToken,
    phoneListId,
    leadsLoaded,
    excludedOptedOutCount,
    excludedDuplicatePhoneCount,
  } = state
  const { id: campaignId, aiContent } = campaign
  const [stopPolling, setStopPolling] = useState(false)
  const [draftOutreachId, setDraftOutreachId] = useState<number | null>(null)

  const contactCount = leadsLoaded ?? undefined
  const effectiveOutreachType = getEffectiveOutreachType(type)
  const purchaseMetaData = {
    contactCount,
    pricePerContact: dollarsToCents(outreachOption?.cost || 0) || 0,
    outreachType: effectiveOutreachType,
    campaignId,
    outreachId: draftOutreachId ?? undefined,
    // Server re-derives the billed count from this token rather than
    // trusting contactCount (ENG-10802).
    phoneListToken: phoneListToken || undefined,
  }

  const trackingAttrs = useMemo(
    () => buildTrackingAttrs('Schedule Contact Campaign Link', { type }),
    [type],
  )

  // ENG-10767: mirrors the audience attribution outside React state — the
  // audience step reports it via onChangeCallback and calls nextCallback in
  // the same tick, so handleNext's trackEvent would otherwise read the
  // pre-update state.
  const audienceTrackingRef = useRef<{
    audienceSource?: AudienceSource
    listId?: number
  }>({})

  const handleChange = useCallback(
    (
      changeSetOrKey: Partial<TaskFlowState> | keyof TaskFlowState | string,
      value?: TaskFlowState[keyof TaskFlowState],
    ) => {
      if (typeof changeSetOrKey === 'object') {
        if (changeSetOrKey.audienceSource) {
          audienceTrackingRef.current = {
            audienceSource: changeSetOrKey.audienceSource,
            ...(changeSetOrKey.audienceListId != null
              ? { listId: changeSetOrKey.audienceListId }
              : {}),
          }
        }
        setState((prevState) => ({
          ...prevState,
          ...changeSetOrKey,
        }))
      } else {
        setState((prevState) => ({
          ...prevState,
          [changeSetOrKey]: value,
        }))
      }
    },
    [],
  )

  const handleClose = () => {
    if (isObjectEqual(state, DEFAULT_STATE) || isLastStep) {
      handleCloseConfirm()
      return
    }

    setConfirmOpen(true)
  }

  const handleCloseCancel = () => {
    setConfirmOpen(false)
  }

  const handleCloseConfirm = () => {
    trackEvent(EVENTS.Dashboard.VoterContact.Texting.ScheduleCampaign.Exit, {
      step: stepName,
    })
    setConfirmOpen(false)
    setOpen(false)
    handleReset()
    onClose?.()
  }

  const handleNext = async () => {
    if (isLastStep) {
      if (stepName !== STEPS.purchase) {
        const contactField = getVoterContactField(type)
        await updateVoterContacts((currentContacts) => ({
          ...currentContacts,
          [contactField]:
            (currentContacts[contactField] || 0) + (state.voterCount || 0),
        }))
      }
      await onComplete?.()
      handleCloseConfirm()
      return
    }
    trackEvent(EVENTS.Dashboard.VoterContact.Texting.ScheduleCampaign.Next, {
      step: stepName,
      // ENG-10767: the audience advance carries how the audience was chosen
      // (read from the ref, not state — see audienceTrackingRef above).
      ...(stepName === STEPS.audience ? audienceTrackingRef.current : {}),
    })
    setState((prevState) => ({
      ...prevState,
      step: state.step + 1,
    }))
  }

  const handleBack = () => {
    if (state.step <= 0) return
    trackEvent(EVENTS.Dashboard.VoterContact.Texting.ScheduleCampaign.Back, {
      step: stepName,
    })
    // Leaving the purchase step invalidates its draft: upstream edits (script,
    // image, audience) must produce a fresh draft on re-entry. Abandoned
    // drafts stay pending_payment and are hidden server-side.
    if (stepName === STEPS.purchase) {
      setDraftOutreachId(null)
    }
    setState({
      ...state,
      step: state.step - 1,
    })
  }

  const handleReset = () => {
    setState(DEFAULT_STATE)
    setDraftOutreachId(null)
    audienceTrackingRef.current = {}
  }

  const handleAddScriptOnComplete = async (
    scriptKeyOrText: string | null,
    scriptContent?: string,
  ) => {
    const scriptKeyValue = String(scriptKeyOrText)
    handleChange('script', scriptKeyOrText)

    const content = scriptContent ?? aiContent?.[scriptKeyValue]?.content
    const scriptText = content
      ? sanitizeHtml(String(content), {
          allowedTags: [],
          allowedAttributes: {},
        })
      : scriptKeyValue

    handleChange('scriptText', scriptText)
    await handleNext()
  }

  const callbackProps = {
    onChangeCallback: handleChange,
    closeCallback: handleClose,
    nextCallback: handleNext,
    backCallback: handleBack,
    resetCallback: handleReset,
  }

  const queryClient = useQueryClient()
  const refreshCampaign = useCallback(async () => {
    queryClient.invalidateQueries({ queryKey: CAMPAIGN_QUERY_KEY })
  }, [queryClient])

  const onCreateOutreach = useMemo(
    () =>
      handleCreateOutreach({
        type,
        state,
        campaignId,
        campaignPlanDueDate,
        textCount: leadsLoaded ?? undefined,
        hasFreeTextsOffer: !!campaign.hasFreeTextsOffer,
        outreaches,
        setOutreaches,
        errorSnackbar,
        refreshCampaign,
      }),
    [
      type,
      state,
      outreaches,
      setOutreaches,
      errorSnackbar,
      refreshCampaign,
      campaignId,
      campaignPlanDueDate,
      leadsLoaded,
      campaign.hasFreeTextsOffer,
    ],
  )

  const onCreateVoterFileFilter = useMemo(
    () =>
      handleCreateVoterFileFilter({
        type,
        state,
        errorSnackbar,
      }),
    [type, state, errorSnackbar],
  )

  const onCreatePhoneList = useMemo(
    () => handleCreatePhoneList(errorSnackbar),
    [errorSnackbar],
  )

  const isPurchaseCompletingRef = useRef(false)
  const isDraftCreatingRef = useRef(false)

  // Draft-first purchase: the campaign is persisted (status pending_payment)
  // BEFORE checkout so the server can finalize it from the Stripe webhook even
  // if this tab dies after paying. The checkout session can't be created until
  // the draft id exists — it rides along in the session metadata.
  useEffect(() => {
    if (
      stepName !== STEPS.purchase ||
      draftOutreachId ||
      isDraftCreatingRef.current ||
      !phoneListId
    ) {
      return
    }
    isDraftCreatingRef.current = true
    ;(async () => {
      try {
        const outreach = await onCreateOutreach({ draft: true })
        if (outreach?.id) {
          setDraftOutreachId(outreach.id)
        } else {
          handleBack()
        }
      } finally {
        isDraftCreatingRef.current = false
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepName, draftOutreachId, phoneListId, onCreateOutreach])

  const handlePurchaseComplete = async () => {
    if (isPurchaseCompletingRef.current) return
    isPurchaseCompletingRef.current = true
    try {
      trackEvent(EVENTS.Dashboard.VoterContact.CampaignCompleted, {
        medium: type,
        price: state.budget,
        voterContacts: state.audience?.count || 0,
        // ENG-10767: closes the CRM list → outreach funnel (joins to
        // Voter Data - Send Outreach Clicked via listId). Fires well after
        // the audience advance, so state is committed here.
        ...(state.audienceSource
          ? { audienceSource: state.audienceSource }
          : {}),
        ...(state.audienceListId != null
          ? { listId: state.audienceListId }
          : {}),
      })
      successSnackbar('Request submitted successfully.')

      const contactField = getVoterContactField(type)
      await updateVoterContacts((currentContacts) => ({
        ...currentContacts,
        [contactField]:
          (currentContacts[contactField] || 0) + (state.voterCount || 0),
      }))

      // The server finalized the draft during payment completion — refetch so
      // the new campaign appears in the list without a reload.
      try {
        const { data } = await clientRequest('GET /v1/outreach', {})
        if (data) {
          setOutreaches(data)
        }
      } catch {
        // Best-effort: an async (deferred) payment finalizes via webhook
        // later, and the list shows the campaign on next load either way.
      }
      await refreshCampaign()

      await handleNext()
    } finally {
      isPurchaseCompletingRef.current = false
    }
  }

  return (
    <>
      <div
        className="cursor-pointer hover:underline"
        onClick={() => setOpen(true)}
        onKeyDown={(e) => e.key === 'Enter' && setOpen(true)}
        {...trackingAttrs}
      >
        {customButton ? (
          customButton
        ) : (
          <span
            role="button"
            tabIndex={0}
            className="mt-4 flex items-center justify-end"
            onClick={() => {
              // NOTE: this text link form is only used on the Voter File Detail page
              trackEvent(
                EVENTS.VoterData.FileDetail.LearnTakeAction.ClickSchedule,
                { type },
              )
            }}
          >
            <span className="mr-2">Schedule Today</span>
            <IoArrowForward />
          </span>
        )}
      </div>
      <CloseConfirmModal
        open={confirmOpen}
        type={type}
        onCancel={handleCloseCancel}
        onConfirm={handleCloseConfirm}
      />
      <Modal
        open={open}
        closeCallback={handleClose}
        disableEnforceFocus={stepName === STEPS.purchase}
      >
        {phoneListToken && (
          <LongPoll<PhoneListStatusResponse | false>
            {...{
              pollingMethod: async () => getP2pPhoneListStatus(phoneListToken),
              onSuccess: (result) => {
                if (result === undefined || result === false) {
                  setStopPolling(true)
                  return
                }
                const {
                  phoneListId,
                  leadsLoaded,
                  excludedOptedOutCount,
                  excludedDuplicatePhoneCount,
                } = result
                handleChange({
                  phoneListId,
                  leadsLoaded,
                  excludedOptedOutCount,
                  excludedDuplicatePhoneCount,
                })
                setStopPolling(true)
              },
              stopPolling,
              limit: 60,
            }}
          />
        )}
        {stepName === STEPS.intro && (
          <InstructionsStep type={type} {...callbackProps} />
        )}

        {stepName === STEPS.audience && (
          <AudienceStep
            type={type}
            withVoicemail={!!state.voicemail}
            audience={state.audience}
            isCustom={isCustom}
            preselectedListId={preselectedListId}
            {...callbackProps}
            onCreateVoterFileFilter={onCreateVoterFileFilter}
            onCreatePhoneList={onCreatePhoneList}
          />
        )}
        {stepName === STEPS.script && (
          <AddScriptStep
            {...{
              type,
              campaign,
              onComplete: handleAddScriptOnComplete,
              defaultAiTemplateId,
              initialScriptText,
              ...callbackProps,
            }}
          />
        )}
        {stepName === STEPS.image && (
          <ImageStep
            type={type}
            image={state.image ?? null}
            {...callbackProps}
          />
        )}
        {stepName === STEPS.schedule && (
          <ScheduleStep
            schedule={state.schedule}
            type={type}
            {...callbackProps}
            // Only call onCreateOutreach if we're on the last step, otherwise
            // we'll call it in the last step
            onCreateOutreach={
              isLastStep ? onCreateOutreach : async () => undefined
            }
            onScheduleOutreach={
              isLastStep
                ? async (outreach) => {
                    if (!outreach?.id) {
                      errorSnackbar(
                        'Campaign could not be created. Please try again.',
                      )
                      return false
                    }
                    trackEvent(
                      EVENTS.Dashboard.VoterContact.CampaignCompleted,
                      {
                        medium: type,
                        price: state.budget,
                        voterContacts: state.audience?.count || 0,
                        ...(state.audienceSource
                          ? { audienceSource: state.audienceSource }
                          : {}),
                        ...(state.audienceListId != null
                          ? { listId: state.audienceListId }
                          : {}),
                      },
                    )
                    successSnackbar('Request submitted successfully.')
                    return true
                  }
                : async () => true
            }
            isLastStep
          />
        )}
        {stepName === STEPS.purchase && !draftOutreachId && (
          <div className="p-4 w-[80vw] max-w-xl">
            <LoadingAnimation {...{}} />
          </div>
        )}
        {stepName === STEPS.purchase && draftOutreachId && (
          <CheckoutSessionProvider
            {...{
              type: PURCHASE_TYPES.TEXT,
              purchaseMetaData,
            }}
          >
            <PurchaseStep
              {...{
                onComplete: handlePurchaseComplete,
                phoneListId,
                phoneListToken: phoneListToken || undefined,
                contactCount,
                type,
                pricePerContact: purchaseMetaData?.pricePerContact,
                outreachId: draftOutreachId,
                excludedOptedOutCount,
                excludedDuplicatePhoneCount,
              }}
            />
          </CheckoutSessionProvider>
        )}
        {stepName === STEPS.download && (
          <DownloadStep
            {...{
              type,
              scriptText: state.scriptText,
              audience: state.audience,
              savedListId: state.savedListId ?? undefined,
              ...callbackProps,
              onCreateOutreach: async () => {
                await onCreateOutreach()
              },
              voterCount: state.voterCount,
            }}
          />
        )}
        {stepName === STEPS.socialPost && (
          <SocialPostStep
            scriptText={state.scriptText}
            {...callbackProps}
            onCreateOutreach={async () => {
              await onCreateOutreach()
            }}
          />
        )}
      </Modal>
    </>
  )
}

export default TaskFlow
