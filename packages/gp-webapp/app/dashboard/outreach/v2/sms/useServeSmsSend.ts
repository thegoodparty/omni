import { useEffect, type MutableRefObject } from 'react'
import { format } from 'date-fns'
import type {
  RecommendedList,
  ServeSmsCreateRequest,
  ServeSmsCreateResponse,
  SocialTone,
} from '@goodparty_org/contracts'
import { clientRequest } from 'gpApi/typed-request'
import { apiRoutes } from 'gpApi/routes'
import { uploadFileToS3 } from '@shared/utils/s3Upload'
import { usePositionName } from '@shared/hooks/usePositionName'
import { grammarizeOfficeName } from 'app/polls/onboarding/utils/grammarizeOfficeName'
import type { PhoneListStatusResponse } from 'helpers/createP2pPhoneList'
import { serveIdentificationIntro } from './smsCompose.util'

// Serve's whole send sequence — everything `SmsFlow` does BELOW the compose
// step when the surface is Serve. It lives here, in one file, rather than as
// branches inside the flow, because the Win sequence it replaces is live,
// revenue-carrying code: the flow gets a two-line early return at each of the
// three Peerly call sites and its own lines are not moved, reindented or
// extracted. Restructuring the two into one shared assembly is the cleaner
// end state and is a deliberate, recorded deferral.
//
// What differs from Win, and why:
//
//   * No Peerly phone list. An elected official has no 10DLC identity to send
//     under, so there is nothing to derive from the saved filter client-side.
//     `createP2pPhoneList` is never called on this path; the Serve create
//     endpoint resolves the audience, scrubs opt-outs and dedupes phones
//     server-side and hands back the counts.
//   * One create call instead of derive-then-create. Win's audience step
//     starts a phone-list job and the review step's effect waits on it; Serve
//     has nothing to wait for, so the audience step just advances and the
//     review step's effect does the single POST.
//   * A different purchase type at checkout (`SERVE_TEXT`), because the
//     `TEXT` handler returns early without a campaignId and finalizes the
//     send to Peerly.
//
// See docs/features/serve-sms.md.

// --- Endpoint ------------------------------------------------------------

// Bound async function rather than a route string, so `clientRequest` keeps a
// literal `APIEndpoints` key and the payload stays typed. Same shape as the
// surface's existing `endpoints.draft`.
//
// NOTE: the route is registered by the module-wiring ticket (B1). Until that
// lands this 404s at runtime; the contract is what is being coded against.
export const createServeSms = async (
  input: ServeSmsCreateRequest,
): Promise<ServeSmsCreateResponse> => {
  const { data } = await clientRequest('POST /v1/outreach/serve/sms', input)
  return data
}

export type ServeSmsCreateFn = (
  input: ServeSmsCreateRequest,
) => Promise<ServeSmsCreateResponse>

// --- Identification ------------------------------------------------------

// The office comes from the organization's position name, NOT from
// `campaign.details.normalizedOffice` — a Serve user has no campaign row, so
// that field is null and Win's intro would read "candidate for local office"
// to someone who already holds the office.
//
// `grammarizeOfficeName` is polls' own function ("City Council" -> "City
// Council Member", " - District 3" stripped). Reused, never re-derived, so
// the two Serve products cannot disagree about how an office is named.
export const useServeSmsIdentification = (
  firstName: string,
): ((tone: SocialTone) => string) => {
  const positionName = usePositionName()
  const office = grammarizeOfficeName(positionName)
  return (tone: SocialTone) => serveIdentificationIntro(tone, firstName, office)
}

// --- Send sequence -------------------------------------------------------

interface ServeSmsSendAudience {
  selectedListId: number | null
  builderName: string
  createListPending: boolean
  createList: () => Promise<unknown>
  createRecommendedList: (
    recommendation: RecommendedList,
    name: string,
  ) => Promise<unknown>
}

export interface UseServeSmsSendInput {
  // False on Win, in which case every callback here is unreachable (the
  // flow's guards never route to them) and the create effect returns
  // immediately. Passed rather than assumed so the hook can be mounted
  // unconditionally, as the rules of hooks require.
  isServe: boolean
  open: boolean
  stepId: string
  scheduled: boolean
  name: string
  composedMessage: string
  // Already stamped to the fixed 11am send hour by ServeSmsScheduleStep, so
  // only its calendar day reaches the payload.
  scheduledAt: Date | null
  image: File | null
  draftOutreachId: number | null
  audience: ServeSmsSendAudience
  create: ServeSmsCreateFn | undefined
  setStepId: (step: 'schedule') => void
  setDraftOutreachId: (id: number) => void
  setDraftCreateError: (value: boolean) => void
  // The flow's own recipient-count state, which every step below review
  // already reads (review's People row, the excluded-count rows, the success
  // screen). Serve fills it from the create response instead of from a
  // Peerly phone-list poll, which is what lets those lines stay untouched.
  setRecipientCounts: (counts: PhoneListStatusResponse) => void
  isDraftCreatingRef: MutableRefObject<boolean>
  draftGenerationRef: MutableRefObject<number>
}

export interface ServeSmsSend {
  audienceContinue: () => void
  createListContinue: () => Promise<void>
  continueWithRecommendation: (
    recommendation: RecommendedList,
    name: string,
  ) => Promise<void>
}

export const useServeSmsSend = ({
  isServe,
  open,
  stepId,
  scheduled,
  name,
  composedMessage,
  scheduledAt,
  image,
  draftOutreachId,
  audience,
  create,
  setStepId,
  setDraftOutreachId,
  setDraftCreateError,
  setRecipientCounts,
  isDraftCreatingRef,
  draftGenerationRef,
}: UseServeSmsSendInput): ServeSmsSend => {
  const { selectedListId } = audience

  // Audience advance. Win derives a Peerly phone list here and polls it
  // across the later steps; Serve has no list to derive, so the step is
  // nothing but a step.
  const audienceContinue = () => {
    if (!selectedListId) return
    setStepId('schedule')
  }

  // Name-step continue: save the built filter through the shared audience
  // hook (which selects it), then advance. Win's phone-list derivation is
  // the only other thing its version does.
  const createListContinue = async () => {
    if (audience.builderName.trim().length === 0 || audience.createListPending)
      return
    try {
      await audience.createList()
      setStepId('schedule')
    } catch {
      // audience.createListError renders the inline message in the step.
    }
  }

  // Recommended lists are Win-only — the endpoint 400s an eo- org and the
  // flow passes no recommendation intent on this surface, so nothing reaches
  // this today. It exists so the Serve path is complete at all three call
  // sites the flow guards, rather than falling through to Peerly if
  // recommendations are ever opened up to Serve.
  const continueWithRecommendation = async (
    recommendation: RecommendedList,
    listName: string,
  ) => {
    await audience.createRecommendedList(recommendation, listName)
    setStepId('schedule')
  }

  // Draft-first create, the Serve twin of the flow's own review-step effect:
  // entering review persists the send as a pending_payment row, and the id it
  // returns gates the checkout session. One POST does what Win needs a phone
  // list plus a create for.
  useEffect(() => {
    if (!isServe) return
    if (stepId !== 'review' || !open || scheduled) return
    if (draftOutreachId || isDraftCreatingRef.current) return
    if (!selectedListId || !scheduledAt) return
    isDraftCreatingRef.current = true
    setDraftCreateError(false)
    const generation = draftGenerationRef.current
    ;(async () => {
      try {
        if (!create) throw new Error('Serve surface has no create endpoint')
        // The compose step requires an image on both surfaces, but the Serve
        // create takes a URL rather than a multipart file, so the bytes go up
        // first. Reuses the elected-office-scoped presign polls already
        // ships; there is no outreach-scoped one to use yet.
        const imageUrl = image
          ? await uploadFileToS3(image, apiRoutes.polls.imageUploadUrl)
          : undefined
        const result = await create({
          name: name.trim(),
          message: composedMessage,
          ...(imageUrl ? { imageUrl } : {}),
          // A calendar day, not an instant: the send hour is fixed at 11am
          // local and is therefore not the client's to choose. Formatted from
          // the local date so an evening render cannot roll it forward the
          // way toISOString() would.
          scheduledLocalDate: format(scheduledAt, 'yyyy-MM-dd'),
          voterFileFilterId: selectedListId,
        })
        // A create that started before the draft was discarded (Back off
        // review) must not resurrect its id — checkout would then charge for
        // the pre-edit message and date.
        if (generation !== draftGenerationRef.current) return
        setRecipientCounts({
          // Never read on this path: the only reader is the flow's Win create
          // effect, which returns at its own guard before it gets here.
          phoneListId: 0,
          leadsLoaded: result.recipientCount,
          excludedOptedOutCount: result.excludedOptedOutCount,
          excludedDuplicatePhoneCount: result.excludedDuplicateCount,
        })
        setDraftOutreachId(result.outreachId)
      } catch {
        // Surfaces as the review step's "We couldn't set up your purchase"
        // card, which is checked ahead of its preparing spinner — a failed
        // create must not leave the pay step spinning forever.
        if (generation === draftGenerationRef.current) {
          setDraftCreateError(true)
        }
      } finally {
        if (generation === draftGenerationRef.current) {
          isDraftCreatingRef.current = false
        }
      }
    })()
  }, [
    isServe,
    stepId,
    open,
    scheduled,
    draftOutreachId,
    selectedListId,
    scheduledAt,
    composedMessage,
    name,
    image,
    create,
    setDraftOutreachId,
    setDraftCreateError,
    setRecipientCounts,
    isDraftCreatingRef,
    draftGenerationRef,
  ])

  return { audienceContinue, createListContinue, continueWithRecommendation }
}
