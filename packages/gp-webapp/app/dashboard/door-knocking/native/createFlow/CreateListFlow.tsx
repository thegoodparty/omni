'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import { Input, Label } from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { extractApiErrorInfo } from 'helpers/extractApiErrorInfo'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { ChannelBadge } from 'app/dashboard/outreach/v2/channelMeta'
import { OutreachFlowShell } from 'app/dashboard/outreach/v2/OutreachFlowShell'
import { PurposeStep } from 'app/dashboard/outreach/v2/PurposeStep'
import { Intro } from 'app/dashboard/outreach/v2/social/Intro'
import {
  builderFiltersFromRecommendation,
  intentForOutreachPurpose,
} from 'app/dashboard/outreach/v2/audience/recommendedListMapping.util'
import {
  transformVoterFileFiltersForBackend,
  type VoterFileFilters,
} from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import type { SupportStatusRollup } from 'app/dashboard/contacts/crm/shared/contacts-types'
import {
  unpreviewableDisclosureLabels,
  unpreviewableDisclosureSentence,
} from './voterFilterPreview'
import { withoutUnshadeableCriteria } from '../savedListFilters'
import { districtUnavailableMessage, packErrorMessage } from '../useVoterPack'
import { suggestTravelMode } from '../travelMode'
import { useCampaign } from '@shared/hooks/useCampaign'
import { useUser } from '@shared/hooks/useUser'
import {
  useDoorKnockingOfficeName,
  useDoorKnockingServeMode,
} from '../doorKnockingSurface'
import { buildIntro, buildServeIntro } from '../doorScriptContent'
import {
  composeCta,
  serializeTalkingPoints,
  type TalkingPointsLines,
} from '../talkingPointsCard'
import { TalkingPointsStep } from './TalkingPointsStep'
import {
  flowStage,
  MAX_CAMPAIGN_NAME_LENGTH,
  previousStage,
  stageStep,
  stepperPosition,
  type CreateFlowStage,
  type CreateFlowStep,
  type PreDrawStage,
} from './createFlowSteps'
import {
  DOOR_KNOCKING_PURPOSES,
  doorKnockingPurposeNameSuggestion,
  type DoorKnockingPurpose,
} from './doorKnockingPurposes'
import {
  SERVE_DOOR_KNOCKING_PURPOSES,
  serveDoorKnockingPurposeNameSuggestion,
  type ServeDoorKnockingPurpose,
} from './serveDoorKnockingPurposes'
import { WhoStep } from './WhoStep'
import { DrawStep } from './DrawStep'
import { DrawFullScreen } from './DrawFullScreen'
import { RouteStep } from './RouteStep'
import type { SavedListOption } from './savedListOptions'
import type {
  DoorKnockingAddressPreviewResponse,
  DoorKnockingMode,
  DoorKnockingTurf,
  RecommendedList,
  RecommendedListFilter,
  RecommendedListIntent,
  RecommendedListVariant,
} from '@goodparty_org/contracts'
import type { PolygonRing } from '../VoterMapCanvas'
import type { PolygonStats } from '../filterEngine'

export type { CreateFlowStep } from './createFlowSteps'

// Hard cap on stops per list — anything over this can't route.
export const HARD_STOP_LIMIT = 150
const CREATE_ERROR_FALLBACK =
  'Building the route failed — nothing was saved. Try again in a moment.'

// Every 4xx from the create endpoint is something the candidate can act on —
// an empty turf, one over the 150-stop cap, a spent daily routing budget — and
// each arrives with its own instruction, none of which is "try again in a
// moment". A 5xx is us or the vendor, where waiting really is the advice.
const toCreateErrorMessage = (error: unknown): string =>
  (error instanceof FetchError &&
    error.status !== undefined &&
    error.status < 500 &&
    extractApiErrorInfo(error.data).message) ||
  CREATE_ERROR_FALLBACK

interface CreateListFlowProps {
  step: CreateFlowStep
  filters: VoterFileFilters
  onFiltersChange: (filters: VoterFileFilters) => void
  onStepChange: (step: CreateFlowStep) => void
  onClose: () => void
  // The pack's bounding box, framed by the draw step's static-map preview
  // card. Null while the pack decodes; the preview omits the image in that
  // window rather than rendering against no rect.
  districtBounds: [[number, number], [number, number]] | null
  // District-wide households matching the filter draft. Honest only before a
  // polygon exists — once one is drawn, everything the draw step reports comes
  // off turfStats instead.
  districtHouseholds: number
  // Whether the count above has an answer yet. It is arithmetic over the pack,
  // not a server call, so it reads 0 for as long as the district takes to
  // download — and this sheet is drawn over the map region that would otherwise
  // have said so.
  districtHouseholdsPending: boolean
  districtHouseholdsFailed: boolean
  // Distinct from failed: there is no request to wait on and no retry to
  // offer, so the step says what is actually wrong instead of asking for a
  // refresh that changes nothing.
  districtUnavailable: boolean
  // The who step's list picker, with the parenthesised district counts the
  // canvas puts beside each row. Empty until the saved lists resolve; the step
  // still offers All Contacts, which is the default anyway.
  savedLists: SavedListOption[]
  allContactsHouseholds: number | null
  ring: PolygonRing | null
  // In-polygon counts for the drawn shape, computed by the page from the pack.
  // The estimate: instant on every ring change, and a superset, since the pack
  // carries no addresses and cannot shade by every filter a list applies.
  turfStats: PolygonStats | null
  // The drawn shape's stops as [lng, lat], from the pack the page holds. The
  // route step's walk-vs-drive suggestion is derived from how spread out they
  // are, which is only answerable before the route is bought — and since the
  // purchase now happens at the end of this flow, this is that moment.
  drawnStops: Array<[number, number]> | null
  // gp-api's answer for the shape the candidate asked about — the addresses
  // themselves, and the exact counts that come with them. Non-null only while
  // it describes the ring currently on screen, and when it is non-null it is
  // what this step reports (ADR 0010): the estimate above becomes the loading
  // state for it rather than a second figure beside it.
  addressPreview: DoorKnockingAddressPreviewResponse | null
  previewPending: boolean
  previewFailed: boolean
  // Asked for, answered, and then a vertex moved. The answer describes a
  // boundary that is no longer on screen, so it is not shown and not counted.
  previewStale: boolean
  // Ask / stop asking / ask again. The page owns the request for the same
  // reason it owns Undo, and because a shut panel must never pay for a scan of
  // people-db.
  onShowAddresses: () => void
  onHideAddresses: () => void
  onRetryAddresses: () => void
  // Boundary points placed so far. `ring` only exists from three points, so
  // this is the only thing that knows there is a one- or two-point shape to
  // undo — and it counts adds, not drags, which never change the total.
  drawPointCount: number
  // Drop the most recently placed vertex. Threaded through to the drawing
  // surface's Undo button, which only renders when there is a point to drop
  // (see DrawFullScreen).
  onUndoPoint: () => void
  // Whether the map is uncovered and being drawn on. It lives on the page
  // beside the draw tokens, not here, because it decides what the CANVAS is
  // doing: the shielded preview window on this step and the live drawing
  // surface are the same map in two states, and the map outlives this panel.
  drawFullScreen: boolean
  onDrawFullScreenChange: (full: boolean) => void
  // Throw the drawn boundary away and open a fresh drawing session on the same
  // map. What "Discard this turf?" means: the canvas keeps the session live
  // behind the draw step's shield, so a discard that merely cleared would leave
  // a map nothing can be drawn on next time the surface opens.
  onRestartDrawing: () => void
  // Auto-assigned rather than picked. The canvas's confirm step is a single
  // name field; the colour a list is drawn in stays editable in
  // `EditTurfDialog`, which is where a candidate looking at the map is when
  // they discover two rings they want to tell apart.
  color: string
  // The whole chain committed: turf, route and outreach envelope all exist.
  // Carries the created row because the page opens the walk on it directly.
  onListCreated: (turf: DoorKnockingTurf) => void
  // Hides the Win-only filters, same contract as the CRM wizard's
  // VoterFileStep. A prop rather than a context read so this stays a plain
  // presentational flow and its tests don't need an organization provider.
  isServeOrg: boolean
  // Selected filter option keys the map preview can't narrow by, so the drawn
  // shape shows more people than the list will target.
  unpreviewableKeys: string[]
  // The organization the recommendations are asked for, purely as a cache-key
  // segment. A prop rather than a `useOrganization()` read for the same
  // reason as `isServeOrg` above.
  orgSlug: string | undefined
  // A saved list the candidate arrived on `?listId=` with, from the outreach
  // hub's door-knocking tile. Undefined is the ordinary flow.
  preselectedListId?: number
  // Reported once the arrival has actually been applied, so the page above can
  // spend it. This flow is unmounted every time the create surface closes, so
  // it cannot remember on its own that the id has already been used.
  onPreselectApplied?: () => void
  // Which saved list the who step is currently attached to. The draft is
  // booleans, and a list's support-status, activity and precinct clauses are
  // not, so the surface above cannot assemble the address-preview request from
  // `filters` alone. The id travels rather than the clauses because the
  // surface already holds the picker's rows, and resolving a list in two
  // places is two chances to disagree about what it carries.
  //
  // An ACCEPTED recommendation has no such row to resolve — it is a list that
  // does not exist yet — so its own two non-boolean clauses travel by value
  // beside the id. Without them the preview asks about the whole district
  // inside the ring while the list being built is supporters-only in a
  // handful of precincts, and the draw step prints that district figure as
  // the count the paid route is built from.
  onSelectedListChange?: (
    listId: number | null,
    recommendedCriteria: RecommendedCriteria,
  ) => void
}

// The clauses an accepted recommendation carries that the who step's boolean
// pill draft has no plane for. Same three-way split as
// `savedListUnshadeableCriteria`, minus activity conditions, which no
// recommendation produces.
export interface RecommendedCriteria {
  precincts: string[]
  supportStatus: SupportStatusRollup[]
}

// The design's stage copy, verbatim (Door knocking 3.0, `renderDkFlow`'s
// `header`). Rendered in the BODY as the shared `intro()` block — channel
// badge, then the title, then the caption — which is where every other
// outreach channel puts it and where the design puts it: the sheet header
// carries only the back button and the stepper.
//
// The route step's title names the list, so it is built below rather than
// stored here.
const STAGE_META: Record<
  Exclude<CreateFlowStage, 'route'>,
  { title: string; caption: string }
> = {
  purpose: {
    title: 'What do you want to do?',
    caption: 'Pick a goal so we can shape the right door knocking list.',
  },
  who: {
    title: 'Who do you want to reach?',
    caption: 'Select a list or create a new list.',
  },
  draw: {
    title: 'Draw your door knocking boundaries',
    caption: 'Outline map areas to build targeted door lists.',
  },
  confirm: {
    title: 'Name your campaign',
    caption: 'Give your campaign a name to find it in your outreach history.',
  },
  points: {
    title: 'What will you say?',
    // The framing the whole feature rests on, and the reason there is no tone
    // control: these are notes a canvasser glances at and puts in their own
    // words, not lines to recite. The step renders no heading of its own —
    // this block is every stage's, and two stacked title/caption pairs is
    // what the points step briefly had.
    caption:
      'Notes for this list — its goal and the people on it — to say in your ' +
      'own words, not a script to read out. Edit anything that does not ' +
      'sound like you.',
  },
}

// The purpose union across both rails this one route serves — same
// convention as PhoneBankingFlow's PhoneBankingFlowPurpose.
type CreateFlowPurpose = DoorKnockingPurpose | ServeDoorKnockingPurpose

const EMPTY_POINTS: TalkingPointsLines = {
  engagementQuestion: '',
  context: '',
  cta: '',
  ask: '',
}

const ROUTE_CAPTION =
  'This helps us draw the most efficient route for you based on how ' +
  'you’re getting there.'

export default function CreateListFlow({
  step,
  filters,
  onFiltersChange,
  onStepChange,
  onClose,
  districtBounds,
  districtHouseholds,
  districtHouseholdsPending,
  districtHouseholdsFailed,
  districtUnavailable,
  savedLists,
  allContactsHouseholds,
  ring,
  turfStats,
  drawnStops,
  drawPointCount,
  onUndoPoint,
  drawFullScreen,
  onDrawFullScreenChange,
  color,
  onListCreated,
  isServeOrg,
  unpreviewableKeys,
  orgSlug,
  preselectedListId,
  onPreselectApplied,
  onSelectedListChange,
}: CreateListFlowProps) {
  const queryClient = useQueryClient()
  const serveMode = useDoorKnockingServeMode()
  const officeName = useDoorKnockingOfficeName()
  // For the talking-points step's composed sections only: the identity clause
  // it previews, and the website its call to action is built from. The
  // candidate's name lives on the user, not the campaign.
  const [campaign] = useCampaign()
  const [user] = useUser()
  const [name, setName] = useState('')
  // The two pre-draw stages the orchestrator cannot see: its `filters` step is
  // this flow's purpose → who phase, and which of the two is on screen is
  // nobody else's business. Survives Back from the draw step because this
  // component stays mounted for the whole flow.
  const [preDrawStage, setPreDrawStage] = useState<PreDrawStage>('purpose')
  const [purpose, setPurpose] = useState<CreateFlowPurpose | null>(null)
  // The goal cards and the name they suggest are the surface's answer: Serve
  // carries its own vocabulary (no election mechanics), and door knocking has
  // ONE route for both rails, so this is the only place the two can differ.
  const purposes = serveMode
    ? SERVE_DOOR_KNOCKING_PURPOSES
    : DOOR_KNOCKING_PURPOSES
  const purposeNameSuggestion = serveMode
    ? serveDoorKnockingPurposeNameSuggestion
    : doorKnockingPurposeNameSuggestion
  // The recommended-lists intent this purpose maps onto
  // (docs/features/recommended-lists.md) — null for `custom`, which gets no
  // recommendation, and null for the whole Serve surface.
  //
  // `!serveMode` is not belt-and-braces: recommended lists are Win-only (the
  // endpoint 400s an eo- org outright) and door knocking is ONE route serving
  // both rails, so the purpose slug alone cannot tell them apart — an elected
  // official picking "Introduce myself" reads as `introduce` exactly as a
  // candidate's does. Without this a Serve session fires a call the endpoint
  // refuses. `PhoneBankingFlow` gates the same map on the same reasoning,
  // from its own Win/Serve discriminator; this is the third surface to need
  // it.
  //
  // The cast rides on that same gate: `!serveMode` is what makes this purpose
  // a member of the Win vocabulary, which is the only one an intent exists
  // for.
  const recommendedListIntent =
    !serveMode && purpose
      ? intentForOutreachPurpose(purpose as DoorKnockingPurpose)
      : null
  // Null means the whole contact universe.
  const [savedListId, setSavedListId] = useState<number | null>(null)
  // Whether the candidate has actively picked an audience yet. Distinct
  // from `savedListId === null`, which is ambiguous — that could mean
  // "nothing picked" or "picked All contacts". The who-step trigger and
  // the Continue button both need to differentiate, so this is flipped
  // true by every writer of `savedListId` (the picker's own click, the
  // recommendation accept, the `?listId=` preselect below) through
  // `selectList`.
  const [hasPickedAudience, setHasPickedAudience] = useState(false)
  // The who step's two faces and its panel. Held here rather than in the step
  // so that a step back from `draw` returns to the face the candidate left —
  // someone who cut a custom audience and pressed Back means to edit those
  // pills, not to be shown the list picker again.
  const [buildingList, setBuildingList] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  // The route the last step buys. Overrides only — `mode` falls back to what
  // the drawn shape's geometry suggests, which can resolve after this mounts.
  const [modeOverride, setModeOverride] = useState<DoorKnockingMode | null>(
    null,
  )
  const [loop, setLoop] = useState(true)

  // The card the canvassers will read. Three of these four lines are the
  // model's; `cta` is composed from the campaign's own website below and is
  // editable but never regenerated.
  const [points, setPoints] = useState<TalkingPointsLines>(EMPTY_POINTS)
  // Whether the boxes hold unmodified AI output or text the candidate typed.
  // Same rule as PhoneBankingFlow's `scriptManuallyEdited`: it decides
  // whether a regenerate is allowed to send the current text as
  // `previousDraft`. Once they have edited, their own words are not something
  // the model should be told to diverge from — an explicit Regenerate still
  // sends it, since that is the candidate asking to discard what is on
  // screen.
  const [pointsManuallyEdited, setPointsManuallyEdited] = useState(false)
  const [instructions, setInstructions] = useState('')
  // Discards a response that arrives after a newer request was fired, so a
  // slow first draft cannot overwrite a fast regenerate.
  const draftRequestRef = useRef(0)

  // A recommendation accepted as a brand-new list carries clauses the who
  // step's boolean pill draft has no plane for — precincts and support
  // status, the same two the picker's saved lists already ride outside
  // `filters` (`savedListUnshadeableCriteria`). Door knocking is the one
  // channel whose recommendation carries a precinct filter
  // (docs/features/recommended-lists.md), so these are spent at create time
  // in the `save` mutation below rather than expressed as pills. Cleared
  // whenever the draft stops being that recommendation: a real saved list is
  // picked, or a pill is hand-edited.
  const [recommendedPrecincts, setRecommendedPrecincts] = useState<string[]>([])
  const [recommendedSupportStatus, setRecommendedSupportStatus] = useState<
    SupportStatusRollup[]
  >([])
  const [recommendedMeta, setRecommendedMeta] = useState<{
    variant: RecommendedListVariant
    intent: RecommendedListIntent
    filter: RecommendedListFilter
    // Reported on the accept event rather than re-derived: these are the
    // figures the candidate actually saw on the card.
    count: number
    voteGoalShare?: number
  } | null>(null)
  const clearRecommendedDraft = useCallback(() => {
    setRecommendedPrecincts([])
    setRecommendedSupportStatus([])
    setRecommendedMeta(null)
  }, [])

  // Choosing a list is two writes that have to happen together: the id here,
  // and the list's own filters lifted into the page's draft so the pills and
  // the map say what the list says. Named once because there are now two ways
  // to choose one — the who step's select, and the `?listId=` preselect below
  // — and a second copy of the pair is a second chance for them to diverge.
  const selectList = useCallback(
    (listId: number | null) => {
      setHasPickedAudience(true)
      setSavedListId(listId)
      clearRecommendedDraft()
      onFiltersChange(
        listId === null
          ? {}
          : (savedLists.find((list) => list.id === listId)?.filters ?? {}),
      )
    },
    [onFiltersChange, savedLists, clearRecommendedDraft],
  )

  // A recommendation that already exists as a saved list selects that list
  // instead of creating a duplicate (reusing `selectList`'s own side
  // effects), matching the pattern the other outreach channels' audience
  // step already applies. A brand-new one prefills the pill draft plus the
  // precinct/support-status carry, and stays on this step — the candidate
  // still presses Continue, exactly as picking a saved list does.
  const applyRecommendation = useCallback(
    (recommendation: RecommendedList) => {
      // Matched against the picker's own rows before it is trusted, exactly
      // as the `?listId=` preselect below is: `existingFilterId` is resolved
      // server-side against this org's saved filters, but a row deleted in
      // the CRM between the recommendations query and the tap would leave
      // `selectList` pointing the picker at a list that is not there — and
      // `selectList` reads that row for the draft's own filters, so a miss
      // silently seeds an EMPTY audience. Falling through builds the list
      // instead, which is what the recommendation described anyway.
      const existingRow =
        recommendation.existingFilterId === null
          ? undefined
          : savedLists.find(
              (list) => list.id === recommendation.existingFilterId,
            )
      if (recommendation.existingFilterId !== null && existingRow) {
        // This branch never reaches the create below, so without its own
        // event an accept of a recommendation the candidate has taken
        // before is invisible. `modified` is false by construction —
        // nothing was submitted, so gp-api has nothing to diff.
        trackEvent(EVENTS.Outreach.RecommendedList.Accepted, {
          variant: recommendation.variant,
          channel: 'doorKnocking',
          intent: recommendedListIntent as RecommendedListIntent,
          count: recommendation.count,
          voteGoalShare: recommendation.voteGoalShare,
          modified: false,
          reusedExistingList: true,
        })
        selectList(existingRow.id)
        return
      }
      const precincts = recommendation.filter.precincts ?? []
      const supportStatus = recommendation.filter.supportStatus ?? []
      setHasPickedAudience(true)
      setSavedListId(null)
      // The boolean MARKS beside the pill draft, exactly as
      // `savedListFilterKeys` leaves them for a picked list: they narrow
      // nothing (`transformVoterFileFiltersForBackend` only emits option
      // keys, so they never reach a create body) and exist so the page's
      // `unpreviewableFilterKeys` can name them in the disclosure. Without
      // them a precinct-restricted recommendation previews as the whole
      // district with nothing on screen saying why.
      onFiltersChange({
        ...builderFiltersFromRecommendation(recommendation.filter),
        ...(precincts.length ? { precincts: true } : {}),
        ...(supportStatus.length ? { supportStatus: true } : {}),
      })
      setRecommendedPrecincts(precincts)
      setRecommendedSupportStatus(supportStatus)
      setRecommendedMeta({
        variant: recommendation.variant,
        // Only reachable while the recommendations query below is enabled,
        // which requires a non-null intent.
        intent: recommendedListIntent as RecommendedListIntent,
        filter: recommendation.filter,
        count: recommendation.count,
        voteGoalShare: recommendation.voteGoalShare,
      })
    },
    [onFiltersChange, selectList, savedLists, recommendedListIntent],
  )

  // A list carried in from the outreach hub's door-knocking tile, so "start a
  // walk from this list" arrives with it already picked instead of asking for
  // it again.
  //
  // It waits for the picker's own rows rather than trusting the param, which
  // is what makes every bad id degrade to the ordinary flow rather than to a
  // picker pointing at a row that isn't there: an id that is malformed,
  // deleted, archived or another org's simply never matches, because these
  // rows come from this org's `GET /v1/voters/voter-file/filters`. The ref
  // makes it a seed and not a binding — pick something else and the arrival
  // is spent, not re-applied when the lists refetch.
  //
  // The ref only covers this mount, and closing the flow unmounts it while
  // `?listId=` stays in the address bar, so the page above is told the moment
  // the id is used. Without that, dismissing and pressing Create list again
  // would keep snapping back to the carried list, and a candidate who arrived
  // from the hub could never start a clean flow without leaving the page.
  const preselectApplied = useRef(false)
  useEffect(() => {
    if (preselectApplied.current || preselectedListId === undefined) return
    if (!savedLists.some((list) => list.id === preselectedListId)) return
    preselectApplied.current = true
    selectList(preselectedListId)
    onPreselectApplied?.()
  }, [preselectedListId, savedLists, selectList, onPreselectApplied])

  // Reported from the state rather than from each of the three places that
  // writes it — the picker, the preselect, and the two ways of leaving a list
  // behind. A fourth writer is easy to add and easy to forget to announce,
  // and the surface above pays for a missed one by previewing an audience the
  // list would not knock.
  // Memoised so the report below fires only when one of the two actually
  // changes: the surface stores what it is handed, and a fresh object every
  // render would set state every render.
  const recommendedCriteria = useMemo(
    () => ({
      precincts: recommendedPrecincts,
      supportStatus: recommendedSupportStatus,
    }),
    [recommendedPrecincts, recommendedSupportStatus],
  )
  useEffect(() => {
    onSelectedListChange?.(savedListId, recommendedCriteria)
  }, [savedListId, recommendedCriteria, onSelectedListChange])

  const stage = flowStage(step, preDrawStage)

  // Recommendations render in the who step's list-picker face only — the
  // same "picker mode, above the saved lists" placement Task 8 used for the
  // other channels' shared audience step.
  const recommendationsVisible = stage === 'who' && !buildingList
  const recommendationsQuery = useQuery({
    // Keyed on the org even though this flow is unmounted on every org switch
    // (it opens from the current org's outreach hub, per
    // `door-knocking/CLAUDE.md`): the react-query cache is global and
    // outlives the unmount by `gcTime`, so an org-less key would hand the
    // next org the previous one's cards for the render before the refetch
    // lands. Matches useOutreachAudience's key.
    queryKey: ['door-knocking-recommendations', orgSlug, recommendedListIntent],
    queryFn: async () => {
      const { data } = await clientRequest(
        'GET /v1/campaigns/mine/recommended-lists',
        {
          channel: 'doorKnocking',
          // Guarded by `enabled` below.
          intent: recommendedListIntent ?? undefined,
        },
      )
      return data
    },
    enabled: recommendationsVisible && recommendedListIntent !== null,
    staleTime: 0,
  })
  const recommendations = recommendationsQuery.data ?? []

  // How narrow the audience was cut.
  const activeFilterCount = Object.values(filters).filter((value) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value),
  ).length

  // If the turf POST fails after the filter was created, the retry reuses the
  // existing filter instead of minting an orphan list per attempt. The ref is
  // only valid for the confirm/points/route steps it was minted in — going
  // back to the filters, or closing, may change the audience, so it resets.
  const createdFilterIdRef = useRef<number | null>(null)
  const releaseOrphanFilter = () => {
    // Best-effort; an orphaned list is a nuisance, not a correctness problem.
    const orphanId = createdFilterIdRef.current
    createdFilterIdRef.current = null
    if (orphanId === null) return
    void clientRequest('DELETE /v1/voters/voter-file/filter/:id', {
      id: String(orphanId),
    }).catch(() => undefined)
  }
  const releaseOrphanFilterRef = useRef(releaseOrphanFilter)
  releaseOrphanFilterRef.current = releaseOrphanFilter
  // The three post-name steps are one retry zone: a create that failed at
  // `route` can be walked back to `points` to fix a line, or to `confirm` to
  // rename, and pressing Build route again must reuse the filter it already
  // minted. Releasing it on the way back would strand that retry.
  useEffect(() => {
    if (step === 'confirm' || step === 'points' || step === 'route') return
    releaseOrphanFilterRef.current()
  }, [step])
  // Closing the flow from confirm or route unmounts without a step change, so
  // the effect above never sees it — only a returned cleanup runs on unmount.
  // Both paths null the ref before deleting, so they can't double-fire.
  useEffect(() => () => releaseOrphanFilterRef.current(), [])

  // One move through the flow, whichever vocabulary it is expressed in. A
  // stage inside the `filters` phase is this component's business alone; a
  // stage that IS a page step reports it, and the surface above turns a
  // return to `filters` into the address panel's reset.
  const goToStage = (next: CreateFlowStage) => {
    const nextStep = stageStep(next)
    if (nextStep === 'filters') setPreDrawStage(next as PreDrawStage)
    if (nextStep !== step) onStepChange(nextStep)
  }
  const back = () => {
    const previous = previousStage(stage)
    if (previous) goToStage(previous)
  }

  // Anything the candidate typed, picked or drew. A pristine flow closes
  // without a question, which is the one thing that keeps the confirm from
  // becoming noise on the X nobody meant to press twice.
  const dirty =
    ring !== null ||
    drawPointCount > 0 ||
    name.trim().length > 0 ||
    purpose !== null ||
    savedListId !== null ||
    activeFilterCount > 0

  // The confirm step arrives with a name already in the box, suggested from
  // the goal the candidate picked. The suggestion is its own record rather
  // than the purpose card's own copy (#1385) — a card label doubling as a
  // default title is how a copy correction renamed live campaigns.
  //
  // Two things stop it, and they are separate. **A typed box is theirs**: one
  // keystroke and no upstream change ever overwrites it again. **A suggestion
  // is spent once applied**: the box follows the purpose while it is
  // untouched, so backing out to pick a different goal brings the new
  // suggestion — but the SAME one is never re-applied.
  //
  // A picked list's own name is deliberately NOT a source. It names an
  // audience that outlives this walk, and reusing it would title every turf
  // cut from that list identically.
  const nameTouched = useRef(false)
  const appliedSuggestion = useRef<string | null>(null)
  useEffect(() => {
    if (step !== 'confirm' || nameTouched.current) return
    const suggestion = purpose ? purposeNameSuggestion(purpose) : ''
    if (!suggestion || suggestion === appliedSuggestion.current) return
    appliedSuggestion.current = suggestion
    setName(suggestion)
  }, [step, purpose, purposeNameSuggestion])

  // Stops are what the router and its 150-stop cap are denominated in; doors
  // are what the candidate walks and what the time estimate is worth. At a
  // multi-unit building one stop is many doors, so reporting stops as doors
  // understated the evening exactly where buildings are densest.
  //
  // One quantity, one number: the preview REPLACES the estimate rather than
  // The pack's counts drive every reading of the drawn shape now that
  // the address-preview panel has left the draw step. Once the route
  // step commits, the paid `POST /door-knocking/turfs` runs its own
  // exact evaluation server-side and freezes the list; the draw step's
  // counts stay pack-derived because they are still ephemeral answers
  // about a boundary the candidate may yet adjust.
  const stops = turfStats?.stops ?? 0
  const doors = turfStats?.households ?? 0
  const people = turfStats?.people ?? 0

  // Derived rather than seeded into state: the pack decodes on its own
  // schedule, so a suggestion that arrives after the route step is on screen
  // still lands. `mode` is the override once there is one, the suggestion
  // until then, and walking when there is nothing to suggest from.
  const suggestedMode =
    drawnStops && drawnStops.length > 0 ? suggestTravelMode(drawnStops) : null
  const mode = modeOverride ?? suggestedMode ?? 'walk'

  // The card's two composed sections, previewed on the step so the candidate
  // reviews five sections rather than the four they can edit.
  //
  // The identity clause is the candidate's own — it is rebuilt at the door for
  // whoever is reading, so a volunteer's card names the candidate instead.
  // Same builders `useDoorScript` composes it with, so the preview cannot
  // drift from the thing it previews.
  const previewIntro = serveMode
    ? buildServeIntro(user, officeName)
    : buildIntro(user, campaign)

  // Section 3, composed rather than generated: the URL is real data, and a
  // model asked to phrase this line could invent one just as easily. Seeded
  // once the campaign record loads, and never overwritten afterwards — a
  // candidate who edited or cleared it meant to.
  const ctaSeededRef = useRef(false)
  const composedCta = composeCta(campaign?.details?.website)
  useEffect(() => {
    if (ctaSeededRef.current || !composedCta) return
    ctaSeededRef.current = true
    setPoints((current) =>
      current.cta.trim() === '' ? { ...current, cta: composedCta } : current,
    )
  }, [composedCta])

  // Deliberately narrower than what the address preview sends, and narrower
  // than the list being walked: the pills only.
  //
  // `describeFilterForTalkingPoints` reads one allowlist of life-circumstance
  // dimensions (age, homeownership, children, veteran, education, marital
  // status, language, income) and discards everything else — precincts,
  // support status, activity conditions, party, the free-text search. Those
  // are targeting mechanics, not things a canvasser can say at a door, and
  // the allowlist keeps them out of the prompt rather than passing them in
  // beside a rule forbidding their use. Carrying them here would only hand
  // the endpoint keys it throws away.
  //
  // A picked saved list still works: `selectList` puts that row's pills into
  // `filters`, which is the part the allowlist actually reads.
  const draftFilters = useMemo(
    () => transformVoterFileFiltersForBackend(filters),
    [filters],
  )

  const draft = useMutation({
    mutationFn: async (input: {
      purpose: CreateFlowPurpose
      currentDraft?: string
      previousDraft?: string
      instructions?: string
    }) => {
      const body = { ...input, filters: draftFilters }
      // Two endpoints for one call, chosen by the same `serveMode` context the
      // create body below uses — a Serve official's card must never be written
      // by the prompt that says "running for".
      const { data } = await (serveMode
        ? clientRequest('POST /v1/outreach/serve/door-knocking/draft', {
            ...body,
            purpose: input.purpose as ServeDoorKnockingPurpose,
          })
        : clientRequest('POST /v1/outreach/door-knocking/draft', {
            ...body,
            purpose: input.purpose as DoorKnockingPurpose,
          }))
      return data
    },
  })

  // Every path into the model goes through here: first draft, Regenerate,
  // Improve with AI, and the error card's Try again.
  //
  // `cta` is deliberately absent from both the request and the response. It is
  // composed from the campaign's website, so the model neither writes it nor
  // is shown it — the prompt bans URLs outright.
  const requestDraft = (
    nextPurpose: CreateFlowPurpose | null,
    currentDraft?: string,
    previousDraft?: string,
  ) => {
    if (!nextPurpose) return
    // Fresh generation for `custom` is refused by the endpoint with a 400, so
    // do not spend the call: a candidate who picked "Something else" is
    // writing their own, and only Improve applies.
    if (nextPurpose === 'custom' && currentDraft === undefined) return
    const requestId = ++draftRequestRef.current
    const trimmed = instructions.trim()
    draft.mutate(
      {
        purpose: nextPurpose,
        ...(currentDraft === undefined ? {} : { currentDraft }),
        ...(previousDraft === undefined ? {} : { previousDraft }),
        ...(trimmed === '' ? {} : { instructions: trimmed }),
      },
      {
        onSuccess: (generated) => {
          if (requestId !== draftRequestRef.current) return
          setPoints((current) => ({ ...current, ...generated }))
          setPointsManuallyEdited(false)
        },
      },
    )
  }

  // The three generated lines as one block, in card order — what the endpoint
  // takes as `currentDraft` (polish this) or `previousDraft` (do not repeat
  // this). The composed CTA is excluded: it is not the model's to polish.
  const generatedBlock = () =>
    [points.engagementQuestion, points.context, points.ask]
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join('\n')

  // Nothing worth freezing if every section a person wrote is blank — a draft
  // that failed and was skipped past should leave the list with no card rather
  // than three newlines, which is what `parseTalkingPoints` would have to
  // reject later.
  //
  // The composed CTA deliberately does not count. It is seeded from the
  // campaign record the moment that loads, so counting it would make this true
  // for every candidate with a website on file — and a failed draft would then
  // freeze a "card" whose only line is the website. At the door that is worse
  // than no card at all: `useDoorScript` treats any stored card as the
  // candidate's answer and drops the issue stances it would otherwise show,
  // so the walk would lose the stances and gain one URL.
  const hasPoints = [
    points.engagementQuestion,
    points.context,
    points.ask,
  ].some((line) => line.trim().length > 0)

  // Drafted on arrival at the step, not on the purpose pick four steps
  // earlier: the audience is not settled until `who`, and a draft written
  // against the wrong filters would be silently stale by the time the
  // candidate read it.
  //
  // Re-drafted if they went back and changed the purpose, because points
  // written for "Introduce myself" are wrong for a turnout walk — but never
  // once they have edited a line. At that point the card is theirs, and
  // Regenerate is how they ask for another.
  const draftedForRef = useRef<CreateFlowPurpose | null>(null)
  useEffect(() => {
    if (step !== 'points') return
    if (draftedForRef.current === purpose) return
    // Declining to re-draft still settles the purpose, or the ref stays behind
    // on the old one while a draft is nominally owed — and every successful
    // draft clears `pointsManuallyEdited`, which re-runs this effect. The next
    // Regenerate or Improve would then land its result and immediately be
    // overwritten by a phantom fresh draft nobody asked for, which on Improve
    // means throwing away the candidate's own wording.
    if (pointsManuallyEdited) {
      draftedForRef.current = purpose
      return
    }
    draftedForRef.current = purpose
    requestDraft(purpose)
    // `requestDraft` is redefined every render and reading it would re-run this
    // on each one; the purpose ref is what decides when a draft is owed. Same
    // shape as the social flow's generate-on-arrival effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, purpose, pointsManuallyEdited])

  const save = useMutation({
    mutationFn: async () => {
      if (!ring) throw new Error('no polygon')
      // A list picked on the who step ALREADY is a `voter-file/filter`, and
      // its id is the same one the turf attaches by — `TurfDetailsDrawer`
      // resolves a turf's list by matching them. So the turf reuses it rather
      // than filing a near-identical copy per shape cut from the same list.
      // It must never reach `createdFilterIdRef`, whose cleanup DELETES what
      // it holds: that ref means "a list this flow minted and may still have
      // to clean up", and the candidate's own saved list is neither.
      let filterId = savedListId ?? createdFilterIdRef.current
      if (filterId === null) {
        const { data: created } = await clientRequest(
          'POST /v1/voters/voter-file/filter',
          {
            // The audience the candidate cut by hand, filed at the moment it
            // is first needed rather than at the who step: a flow abandoned
            // before this point leaves no list behind. A candidate who PICKED
            // a list arrives with `savedListId` set and never reaches here, so
            // the campaign's own name is the only name this list can take.
            name: name.trim(),
            ...transformVoterFileFiltersForBackend(filters),
            // The precinct/support-status carry from an accepted
            // recommendation (docs/features/recommended-lists.md) — empty
            // for a hand-cut audience or one picked from the saved-lists
            // rail, since those never populate this state.
            ...(recommendedPrecincts.length
              ? { precincts: recommendedPrecincts }
              : {}),
            ...(recommendedSupportStatus.length
              ? { supportStatus: recommendedSupportStatus }
              : {}),
            // Sent alongside the submitted criteria purely so gp-api can
            // diff the two and persist recommendedModified — nothing
            // recommendation-time is otherwise saved anywhere to diff
            // against.
            ...(recommendedMeta
              ? {
                  recommendedVariant: recommendedMeta.variant,
                  recommendedChannel: 'doorKnocking',
                  recommendedIntent: recommendedMeta.intent,
                  recommendedFilter: recommendedMeta.filter,
                }
              : {}),
          },
        )
        filterId = created.id
        // Fired here rather than in `onSuccess`, because this is the moment
        // the recommendation was accepted: the list exists from now on even
        // if the paid route below fails, and a retry short-circuits on
        // `createdFilterIdRef` so it cannot fire twice. `recommendedModified`
        // is gp-api's own diff of the recommendation against what was
        // actually submitted, and is knowable nowhere earlier.
        if (recommendedMeta) {
          trackEvent(EVENTS.Outreach.RecommendedList.Accepted, {
            variant: recommendedMeta.variant,
            channel: 'doorKnocking',
            intent: recommendedMeta.intent,
            count: recommendedMeta.count,
            voteGoalShare: recommendedMeta.voteGoalShare,
            modified: created.recommendedModified ?? false,
            reusedExistingList: false,
          })
        }
      }
      if (savedListId === null) createdFilterIdRef.current = filterId
      const closedRing: PolygonRing =
        ring[0]?.[0] !== ring[ring.length - 1]?.[0] ||
        ring[0]?.[1] !== ring[ring.length - 1]?.[1]
          ? [...ring, ring[0] as [number, number]]
          : ring
      // The one paid call in the feature, and the only write that persists
      // anything from this flow. It creates the turf, buys the Geoapify route
      // and writes the outreach envelope in a single transaction, so a
      // failure here leaves nothing behind and the flow stays exactly as it
      // is — polygon, filters, name, colour, mode and loop all intact — for a
      // retry or a step back.
      //
      // Two endpoints for one call, because creation is the only place the
      // Win/Serve scope of the envelope is chosen and it must not be re-derived
      // server-side from whatever the org happens to hold (ENG-10976). The rail
      // this list will appear on is the one that is already on screen — same
      // `serveMode`, from the same context.
      const body = {
        voterFileFilterId: filterId,
        name: name.trim(),
        color,
        geoPoly: { type: 'Polygon' as const, coordinates: [closedRing] },
        mode,
        loop,
        // Why this list is being walked, and the card its canvassers read —
        // frozen with the route for the same reason the door list is: everyone
        // works from the same plan. Both optional server-side, so a flow that
        // skipped the points step still creates a turf.
        ...(purpose ? { purpose } : {}),
        ...(hasPoints ? { talkingPoints: serializeTalkingPoints(points) } : {}),
      }
      const { data } = await (serveMode
        ? clientRequest('POST /v1/door-knocking/serve/turfs', body)
        : clientRequest('POST /v1/door-knocking/turfs', body))
      createdFilterIdRef.current = null
      return data
    },
    onSuccess: (turf) => {
      // One event, because creating the list and building its route are one
      // transaction.
      trackEvent(EVENTS.DoorKnocking.ListCreated, {
        stops,
        people,
        // Without shipping which filters — the demographics themselves stay
        // out of the analytics payload.
        filterCount: activeFilterCount,
        mode,
        loop,
        // Beside `mode`, the only read on whether the geometry-derived default
        // is any good: equal means it was accepted, different means it was
        // deliberately overruled, null means there was nothing to suggest from.
        suggestedMode,
      })
      void queryClient.invalidateQueries({ queryKey: ['door-knocking-turfs'] })
      void queryClient.invalidateQueries({
        queryKey: ['door-knocking-saved-lists'],
      })
      // Both daily allowances just moved — this turf spent one campaign and
      // its stops — and the next press reads them to decide whether to open
      // the flow at all.
      void queryClient.invalidateQueries({ queryKey: ['door-knocking-quota'] })
      onListCreated(turf)
    },
    onError: (error) => {
      trackEvent(EVENTS.DoorKnocking.RouteBuildFailed, {
        mode,
        loop,
        // Separates the failures the candidate can act on (400 empty turf or
        // over the stop cap, 429 daily routing budget) from the vendor being
        // down (502) — different problems with very different fixes.
        status: error instanceof FetchError ? error.status : undefined,
      })
    },
  })

  const overCap = stops > HARD_STOP_LIMIT
  // The per-list stop cap above is the only thing the drawing surface
  // enforces. A daily allowance used to be checked here too: a 500-stop
  // budget rode the address preview, so a shape could be refused for its size
  // once the addresses came back. That limit is gone, and the one that
  // replaced it counts campaigns rather than stops — which makes it knowable
  // before any drawing happens, so the page refuses to open the flow at all
  // on a spent day rather than letting a candidate draw and then taking the
  // shape away.

  const unpreviewableDisclosure = unpreviewableDisclosureSentence(
    unpreviewableDisclosureLabels(unpreviewableKeys),
    savedListId !== null,
  )

  // Leaving the drawing surface. Back is a step-back inside the flow, not a
  // close — the drawn shape stays and the candidate lands on the draw step
  // where they can Continue with it or open the drawing surface again to
  // adjust. The old "Discard this turf?" prompt fired here whenever Back
  // was pressed with any vertices, which read as "you're about to lose
  // work" for a gesture that never lost any.
  const leaveFullScreen = () => {
    onDrawFullScreenChange(false)
  }

  // The drawing surface is the one thing that renders OUTSIDE the shell:
  // it takes over the whole map with its own chrome, at a z-index above
  // the sheet, and only ever appears from the draw stage. Every other
  // stage — draw included, when the surface is not up — flows through the
  // shell below with its own body branch.
  if (stage === 'draw' && drawFullScreen) {
    return (
      <DrawFullScreen
        pointCount={drawPointCount}
        // The design's bare word, in every state. What the button is
        // waiting for is said by the surface rather than by the button:
        // the centred hint names the gesture until the first point lands,
        // and the count pill (in the drawing surface itself, once a point
        // is placed) reads the shape from there. A button that renames
        // itself three times is three controls to read where the design
        // draws one.
        continueDisabled={!ring || stops === 0 || overCap}
        onContinue={() => {
          onDrawFullScreenChange(false)
          goToStage('confirm')
        }}
        onClose={leaveFullScreen}
        onUndoPoint={onUndoPoint}
        drawStopCount={stops}
        drawStopsOverCap={overCap}
      />
    )
  }

  const title =
    stage === 'route'
      ? 'Will you be walking or driving?'
      : STAGE_META[stage].title
  const caption = stage === 'route' ? ROUTE_CAPTION : STAGE_META[stage].caption
  const { currentStep, totalSteps } = stepperPosition(stage)

  return (
    <OutreachFlowShell
      open
      onClose={onClose}
      title={title}
      headerBadge={<ChannelBadge type="nativeDoorKnocking" />}
      currentStep={currentStep}
      totalSteps={totalSteps}
      onBack={previousStage(stage) ? back : undefined}
      dirty={dirty}
      cta={
        // The purpose step has no footer: choosing a card is the advance, so a
        // CTA under it would be a second way to do the same thing, disabled
        // until the first one was used.
        stage === 'purpose'
          ? null
          : stage === 'who'
            ? {
                // The design puts the filtered audience's size in this button.
                // It is the one number on the step that moves as a pill is
                // toggled — the picker's own `All Contacts (N)` is the
                // UNFILTERED universe and does not — so it is also the only
                // reading of how big the audience being cut actually is.
                //
                // While there is no answer the button carries the design's bare
                // word instead, which is what phone banking's identical CTA
                // already does on the same shell. `Continue (0)` is not a
                // pending state: it is a real-looking number, and the reading a
                // candidate takes from it — this district has nobody in it — is
                // the opposite of the truth. A failed pack has no answer coming
                // at all, so it is bare for the same reason; what went wrong is
                // said in the body, where there is room to say it.
                // Bare "Continue" until the candidate has actually picked
                // an audience — otherwise the count in the button reads
                // as a preselection ("Continue (12,000)" on a fresh who
                // step implied a list was already chosen, when in fact
                // nothing was picked and `districtHouseholds` was just
                // the full district population). Once picked, the count
                // returns as the honest size of the audience being
                // advanced. Failed / unavailable / still-pending also
                // suppress the count for their own reasons above.
                label:
                  !hasPickedAudience ||
                  districtHouseholdsPending ||
                  districtHouseholdsFailed ||
                  districtUnavailable
                    ? 'Continue'
                    : `Continue (${districtHouseholds.toLocaleString()})`,
                disabled:
                  !hasPickedAudience ||
                  districtHouseholdsPending ||
                  districtHouseholdsFailed ||
                  districtUnavailable ||
                  districtHouseholds === 0,
                loading: districtHouseholdsPending,
                // Always the draw step. Building a new list is a way of
                // choosing the audience, not a way of finishing early —
                // there is no door knocking without a boundary and a route.
                onClick: () => goToStage('draw'),
              }
            : stage === 'draw'
              ? {
                  // Bare word — the shape's own count sits on the drawing
                  // surface, and the disclosure sentence and cap warnings are
                  // below this step's preview card, so a count in the CTA
                  // would be the third place saying the same number.
                  label: 'Continue',
                  disabled: !ring || stops === 0 || overCap,
                  onClick: () => goToStage('confirm'),
                }
              : stage === 'confirm'
                ? {
                    // "Continue", not "Save" — nothing is written yet at this
                    // step. The only write in the flow happens on the route
                    // step's Build route CTA (turf + Geoapify route + outreach
                    // envelope, in one paid transaction). Calling this "Save"
                    // read as commit and cost, when it's really just the next
                    // step.
                    label: 'Continue',
                    disabled: name.trim().length === 0,
                    onClick: () => goToStage('points'),
                  }
                : stage === 'points'
                  ? {
                      // Never blocked on the draft — not on a failure, not on
                      // a slow model, not on an empty card. A candidate who
                      // would rather write their points on paper must not be
                      // held back from the route they came to buy, which is
                      // why the field is optional server-side too. Unlike
                      // phone banking, which gates this CTA on its draft
                      // because its script is required. Leaving mid-draft
                      // loses nothing: a draft that lands after the step is
                      // still in state when Build route reads it.
                      label: 'Continue',
                      onClick: () => goToStage('route'),
                    }
                  : {
                      // While the mutation runs, the button shows both a
                      // spinner (via `loading`) and the "Building route"
                      // label — same treatment the design calls for on the
                      // one CTA whose click starts a paid multi-second
                      // request.
                      label: save.isPending ? 'Building route' : 'Build route',
                      disabled: save.isPending,
                      loading: save.isPending,
                      onClick: () => save.mutate(),
                    }
      }
    >
      <div className="flex flex-col gap-6">
        <Intro channel="nativeDoorKnocking" title={title} body={caption} />

        {stage === 'purpose' && (
          <PurposeStep
            purposes={purposes}
            selected={purpose}
            onSelect={(next) => {
              setPurpose(next)
              goToStage('who')
            }}
          />
        )}

        {stage === 'who' && (
          <>
            <WhoStep
              filters={filters}
              onFiltersChange={(next) => {
                // Editing a pill is leaving the named list — or the accepted
                // recommendation — behind: the draft is no longer that list,
                // so the offer to save it as a new one comes back. The list's
                // own support-status, activity and precinct clauses leave
                // with it — nothing can carry them onto the new list, so a
                // draft that kept their marks would go on disclosing a filter
                // that list will never apply.
                setSavedListId(null)
                clearRecommendedDraft()
                onFiltersChange(withoutUnshadeableCriteria(next))
              }}
              savedLists={savedLists}
              allContactsHouseholds={allContactsHouseholds}
              selectedListId={savedListId}
              onSelectList={selectList}
              hasPickedAudience={hasPickedAudience}
              // True while the draft came from a recommendation card
              // rather than a picker pick — the who step suppresses its
              // own selected-state visuals then, so the audience isn't
              // shown twice.
              hasActiveRecommendation={recommendedMeta !== null}
              isServeOrg={isServeOrg}
              building={buildingList}
              onBuildingChange={(next) => {
                // Opening the filter pills leaves the named list behind: what
                // gets cut from here is a new audience, not that list.
                if (next) selectList(null)
                setBuildingList(next)
              }}
              open={listOpen}
              onOpenChange={setListOpen}
              recommendations={recommendations}
              recommendationsLoading={recommendationsQuery.isLoading}
              recommendationsError={recommendationsQuery.isError}
              onSelectRecommendation={applyRecommendation}
            />
            {/* The pack-pending sentence used to sit here ("Loading your
                voter map…") to explain a Continue that would otherwise sit
                dead for up to 34s. It was correct when the whole flow
                covered the map region that carried the same message, but
                it broke the who step from the candidate's point of view —
                a step asking "who do you want to reach" that mentioned
                voter maps read as leaking implementation. The Continue
                button's own `loading` state (spinner) is now the only
                pack-pending signal on this step, which is what phone
                banking and every other channel's audience step already
                does. */}
            {/* Failure is different: `retry: 0` means a failed pack is
                final, so without this the step is a permanently disabled
                Continue with the reason hidden behind it. */}
            {districtHouseholdsFailed && (
              <p role="alert" className="text-sm text-destructive">
                {packErrorMessage(serveMode)}
              </p>
            )}
            {/* And the case that is neither: no request was made, so there is
                nothing to wait for and nothing a refresh would fix. Left to
                the two above it, this step was a disabled Continue under a
                promise of a download that was never going to arrive. */}
            {districtUnavailable && (
              <p role="alert" className="text-sm text-muted-foreground">
                {districtUnavailableMessage(serveMode)}
              </p>
            )}
            {/* The count in the CTA is the pack's, and the pack cannot shade
                every way a saved list narrows — a list cut by support status
                or prior outreach previews as the whole district here. Without
                this the gap would first appear on the draw step, two moves
                after the number that provoked it, and a candidate starting
                from a 256-person list would read the district figure as their
                list being ignored. */}
            {unpreviewableDisclosure && (
              <p className="text-xs text-muted-foreground">
                {unpreviewableDisclosure}
              </p>
            )}
          </>
        )}

        {stage === 'draw' && (
          <DrawStep
            districtBounds={districtBounds}
            matchingHouseholds={districtHouseholds}
            selectedHouseholds={doors}
            onOpenFullScreen={() => onDrawFullScreenChange(true)}
          />
        )}

        {stage === 'confirm' && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="turf-name" className="text-sm font-medium">
              Campaign name
            </Label>
            <Input
              id="turf-name"
              autoFocus
              value={name}
              maxLength={MAX_CAMPAIGN_NAME_LENGTH}
              placeholder="Name this list"
              onChange={(event) => {
                nameTouched.current = true
                setName(event.target.value)
              }}
            />
          </div>
        )}

        {stage === 'points' && (
          <TalkingPointsStep
            intro={previewIntro}
            // The name they gave the list one step ago, which says more about
            // who is being walked than any summary of the pills would.
            audienceLabel={name.trim() || 'this list'}
            lines={points}
            onLineChange={(key, value) => {
              setPointsManuallyEdited(true)
              setPoints((current) => ({ ...current, [key]: value }))
            }}
            instructions={instructions}
            onInstructionsChange={setInstructions}
            // Regenerate discards what is on screen deliberately, so the
            // rejected text always rides along as `previousDraft` — that is
            // what stops the re-roll converging on the thing just turned down.
            onRegenerate={() =>
              requestDraft(purpose, undefined, generatedBlock() || undefined)
            }
            onImprove={() => requestDraft(purpose, generatedBlock())}
            // Nothing to polish until something is written, and a purpose the
            // candidate is writing themselves has only this path.
            canImprove={generatedBlock().length > 0}
            isDrafting={draft.isPending}
            isDraftError={draft.isError}
            isCustomPurpose={purpose === 'custom'}
          />
        )}

        {stage === 'route' && (
          <>
            <RouteStep
              mode={mode}
              onModeChange={setModeOverride}
              loop={loop}
              onLoopChange={setLoop}
              suggested={suggestedMode}
            />
            {save.isError && (
              <p role="alert" className="text-sm text-destructive">
                {toCreateErrorMessage(save.error)}
              </p>
            )}
          </>
        )}
      </div>
    </OutreachFlowShell>
  )
}
