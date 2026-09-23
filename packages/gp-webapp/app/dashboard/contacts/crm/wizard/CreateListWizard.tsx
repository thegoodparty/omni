'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import { Button, DrawerTitle, Input, Stepper } from '@styleguide'
import { useSnackbar } from 'helpers/useSnackbar'
import { clientRequest } from 'gpApi/typed-request'
import { useOrganization } from '@shared/organization-picker'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { outreachAudienceListsKey } from 'app/dashboard/outreach/v2/audience/useOutreachAudience'
import {
  ringsToGeoJsonShape,
  type PolygonRing,
} from 'app/dashboard/shared/ringGeometry'
import { listPeopleQueryKey } from '../map/useListPeople'
import { useContactsTable } from '../ContactsTableProvider'
import { getContactsLabels } from '../../../shared/contactsLabels'
import CrmSheet from '../shared/CrmSheet'
import { LOCKED_LIST_MESSAGE } from '../shared/constants'
import { boundarySaveErrorMessage } from '../shared/boundarySaveError'
import { MAX_SEGMENT_NAME_LENGTH } from '../shared/segments.util'
import type {
  SegmentResponse,
  SupportStatusRollup,
} from '../shared/contacts-types'
import {
  countSelectedFilterCategories,
  hasAnyVoterFileSelection,
  hasPartyFilterSelection,
  CLEARED_VOTER_FILE_FILTERS,
  segmentToVoterFileFilters,
  transformVoterFileFiltersForBackend,
  type VoterFileFilters,
} from '../shared/voterFileFilterTransform.util'
import BranchStep, { type ListWizardBranch } from './BranchStep'
import VoterFileStep from './VoterFileStep'
import { usePrecinctOptions } from './usePrecinctOptions'
import ActivityStep, {
  blankActivityCondition,
  isActivityStepValid,
  toActivityConditionPayload,
  toWizardActivityConditions,
  type WizardActivityCondition,
} from './ActivityStep'
import NameStep from './NameStep'
import BoundaryStep from './BoundaryStep'
import { useListWizardCount } from './useListWizardCount'
import { useListWizardOverlapCount } from './useListWizardOverlapCount'
import { useListWizardPolygonCount } from './useListWizardPolygonCount'
import OverlapBar from './OverlapBar'

type WizardStepName = 'branch' | 'conditions' | 'boundary' | 'name'

// ENG-10767: per-stage funnel events (see the ListWizard registry comment in
// analyticsHelper.ts) — this wizard is URL-stable, so RouteTracker page views
// can't see its stages.
const STAGE_VIEWED_EVENTS: Record<WizardStepName, string> = {
  branch: EVENTS.Contacts.ListWizard.MethodViewed,
  conditions: EVENTS.Contacts.ListWizard.ConditionsViewed,
  boundary: EVENTS.Contacts.ListWizard.BoundaryViewed,
  name: EVENTS.Contacts.ListWizard.NameViewed,
}

interface CreateListWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Present = edit mode (ENG-10725 "Edit list"): the same sheet, seeded from
  // a saved list, collapsed to its conditions step, saving with PUT instead
  // of POST. Null/absent = the create flow.
  editingSegment?: SegmentResponse | null
}

// The list creation wizard (ENG-10708 locked design): branch chooser ->
// branch-specific conditions -> name + build. Serve has no outreach
// (deferred by design, ENG-10750), so its flow drops the branch chooser and
// opens directly on the constituent-file filters, and it alone gains the
// boundary step between the conditions and the name — this derived `steps`
// array is THE Serve gate; when Serve outreach ships, reopen the branch
// here.
export default function CreateListWizard({
  open,
  onOpenChange,
  editingSegment = null,
}: CreateListWizardProps) {
  const {
    isElectedOfficial,
    isWinContext,
    isWinContextReady,
    refreshCustomSegments,
    selectList,
    customSegments,
    voterDataUnavailable,
  } = useContactsTable()
  const { successSnackbar, errorSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const orgSlug = useOrganization()?.slug
  const bodyRef = useRef<HTMLDivElement>(null)

  const isEditing = editingSegment !== null

  // Edit collapses to a single screen (ENG-10725 "Edit list"): the branch is
  // already decided by what the list was built from, and the name moves into
  // the header beside the filters rather than getting its own step.
  const steps: readonly WizardStepName[] = isEditing
    ? ['conditions']
    : // The page's "Create new list" button is disabled until
      // isWinContextReady, so the wizard never opens on an unsettled mode.
      isWinContext
      ? ['branch', 'conditions', 'name']
      : ['conditions', 'boundary', 'name']

  const [stepIndex, setStepIndex] = useState(0)
  const [branch, setBranch] = useState<ListWizardBranch | null>(null)
  const [demographicFilters, setDemographicFilters] =
    useState<VoterFileFilters>({})
  const [supportStatus, setSupportStatus] = useState<SupportStatusRollup[]>([])
  const [precincts, setPrecincts] = useState<string[]>([])
  // Gated on `open` because this component never unmounts — CrmContactsPage
  // always renders it and only toggles `open` — so an ungated fetch ran on
  // every contacts page load for every Win user, whether or not they opened
  // the wizard. In prod that produced a 29% error rate on the endpoint (a
  // non-Pro page load 400s on the Pro gate) while the sibling count queries,
  // which gate the same way, took zero. `voterDataUnavailable` for the same
  // reason the count does: an org with no resolvable district can only 400.
  const precinctOptions = usePrecinctOptions(open && !voterDataUnavailable)
  const [activityConditions, setActivityConditions] = useState<
    WizardActivityCondition[]
  >(() => [blankActivityCondition()])
  const [name, setName] = useState('')
  // Held as the open ring the map draws, not as the GeoJSON it is saved as,
  // so Back onto the boundary step restores the shape with its handles
  // rather than a closed polygon that has to be reopened to be edited.
  const [boundaryRings, setBoundaryRings] = useState<PolygonRing[]>([[]])
  const [boundaryActiveIndex, setBoundaryActiveIndex] = useState(0)

  // Serve never renders the branch chooser, so its branch is a constant —
  // derived, not set on open, so no frame can render the activity branch
  // while a reset effect is still pending. Edit derives it the same way, from
  // what the saved list was built with: switching a list between the two is
  // what Duplicate is for, so edit never offers the chooser.
  const activeBranch: ListWizardBranch | null = editingSegment
    ? editingSegment.activityConditions?.length
      ? 'activity'
      : 'voterFile'
    : isWinContext
      ? branch
      : 'voterFile'
  const stepName: WizardStepName = steps[stepIndex] ?? 'conditions'

  // ENG-10767: bumps once per wizard open, from the reset effect below, so
  // the stage-Viewed effect can't fire on the stale pre-reset stage a
  // reopened wizard renders for one commit (stepIndex resets asynchronously).
  const [openSession, setOpenSession] = useState(0)

  // Fresh wizard state every time it opens — a cancelled-then-reopened
  // wizard must not resume a half-built prior list. Edit seeds from the saved
  // list in the same pass, so the pills, name, and live count are the list's
  // own from the first frame rather than flashing an empty selection.
  useEffect(() => {
    if (!open) return
    setStepIndex(0)
    setBranch(null)
    setDemographicFilters(
      editingSegment ? segmentToVoterFileFilters(editingSegment) : {},
    )
    setSupportStatus(editingSegment?.supportStatus ?? [])
    setPrecincts(
      Array.isArray(editingSegment?.precincts)
        ? (editingSegment.precincts as string[])
        : [],
    )
    setActivityConditions(
      editingSegment?.activityConditions?.length
        ? toWizardActivityConditions(editingSegment.activityConditions)
        : [blankActivityCondition()],
    )
    setName(editingSegment?.name ?? '')
    setBoundaryRings([[]])
    setBoundaryActiveIndex(0)
    setOpenSession((session) => session + 1)
    // Keyed on the edited list's ID, not on `open` alone: `open` is a derived
    // OR of two independent sources (the page's create button and the
    // provider's editingSegment), so a switch straight from editing one list
    // to another — or to a create — never passes through `false`, and an
    // effect that only watched `open` would leave the previous list's name,
    // pills, and conditions seeded under create-mode chrome. The ID rather
    // than the object: the segments query refetching underneath the sheet
    // hands back a new object for the same list, and re-seeding mid-edit
    // would throw away the user's in-progress changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingSegment?.id])

  // ENG-10767: stage Viewed fires on every stage entry — including Back
  // re-entry — keyed on the open session + active-stage identifier ONLY
  // (instrument-analytics-event skill rule), never on unrelated re-renders
  // (e.g. picking a branch card re-renders with the same stepName). The
  // openSession guard skips the mount run and any pre-reset stale stage; the
  // page's create button is disabled until isWinContextReady, so the context
  // is settled whenever the wizard is open.
  useEffect(() => {
    if (openSession === 0) return
    // These are the CREATE funnel's stages — an edit reuses the conditions
    // screen but never reaches NameCompleted, so counting it here would
    // inflate the middle of the funnel with sessions that can't convert.
    if (isEditing) return
    trackEvent(STAGE_VIEWED_EVENTS[stepName], {
      context: isWinContext ? 'win' : 'serve',
      ...(stepName !== 'branch' && activeBranch
        ? { branch: activeBranch }
        : {}),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSession, stepName])

  // Multi-step flow: reset scroll to the top of the sheet's own scrollable
  // body (not window) on every step change (app/dashboard/CLAUDE.md
  // convention), so a long filter list on the conditions step doesn't leave
  // the name step opening mid-scroll.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [stepIndex])

  // Also the save payload, so the number on the CTA is always exactly what
  // gets persisted. Two things ride along in edit mode for that reason: the
  // retired age columns are explicitly cleared (the wizard can't render them,
  // so a stale one would filter the saved list without appearing in the
  // count), and a list saved from a search carries its term forward (dropping
  // it from the count would preview a wider audience than the list holds).
  const editingSearch =
    typeof editingSegment?.search === 'string' && editingSegment.search
      ? editingSegment.search
      : null

  const backendPayload = useMemo(() => {
    if (activeBranch === 'voterFile') {
      return {
        // Baseline first so the selection overlays it: the two conditional
        // spreads below drop out when their selection is empty, and without
        // the baseline's explicit `[]` under them, clearing every support
        // status or precinct pill would omit the key and leave the saved
        // list filtering on the old value.
        ...(isEditing ? CLEARED_VOTER_FILE_FILTERS : {}),
        ...transformVoterFileFiltersForBackend(demographicFilters),
        ...(supportStatus.length ? { supportStatus } : {}),
        ...(precincts.length ? { precincts } : {}),
        ...(editingSearch ? { search: editingSearch } : {}),
      }
    }
    if (activeBranch === 'activity') {
      return {
        // The cleared baseline, not just the conditions: a list can hold
        // voter-file columns alongside its activity conditions, and this
        // branch renders none of them, so leaving them set would persist a
        // filter the user never saw and the count never included.
        ...(isEditing ? CLEARED_VOTER_FILE_FILTERS : {}),
        activityConditions: toActivityConditionPayload(activityConditions),
        ...(editingSearch ? { search: editingSearch } : {}),
      }
    }
    return {}
  }, [
    activeBranch,
    demographicFilters,
    supportStatus,
    precincts,
    activityConditions,
    isEditing,
    editingSearch,
  ])

  // ENG-10751: an empty voter-file selection would just recreate the
  // pre-built "All voters" list, so zero filters blocks the build (reversing
  // the ENG-10725 valid-unfiltered-submission stance).
  const isConditionsStepValid =
    activeBranch === 'voterFile'
      ? hasAnyVoterFileSelection(demographicFilters, supportStatus, precincts)
      : activeBranch === 'activity'
        ? isActivityStepValid(activityConditions)
        : false

  // The activity count stays gated on a valid selection: an incomplete
  // condition would send activityConditions: [] — the backend treats that as
  // unfiltered and the cached total would render on the build button. The
  // voter-file count deliberately fires with zero selections (ENG-10751):
  // the disabled build button still shows the live unfiltered total.
  // The edited list's drawn boundary rides the COUNT payload only, never
  // backendPayload — that object is also the save payload, and the wizard's
  // update deliberately never sends geoPoly so a partial PUT leaves the
  // shape alone. The number still has to account for it: an inline filter
  // carries no id and no geoPoly, so without this the count answered with
  // the list's pre-boundary size and offered "Save changes (5,356)" on a
  // list whose own detail sheet read 339.
  const countPayload = useMemo(
    () =>
      isEditing && editingSegment
        ? { ...backendPayload, boundaryFromSegmentId: editingSegment.id }
        : backendPayload,
    [backendPayload, isEditing, editingSegment],
  )

  const { count, isLoading, isStale, isError, isCapError, errorMessage } =
    useListWizardCount(
      countPayload,
      // The voter-file count fires on every pill toggle, so an org with no
      // resolvable district produced one 400 per keystroke-debounced change.
      !voterDataUnavailable &&
        (activeBranch === 'voterFile' ||
          (activeBranch === 'activity' && isConditionsStepValid)),
    )

  // ENG-10781: a selection that RESOLVES to zero matches must not advance —
  // it can't build anything. Gated on !isLoading && !isStale so a payload
  // still in-flight/debouncing (buildLabel below already hides the number in
  // that window) can't flash the CTA disabled-then-enabled as the trailing
  // count lands; only a settled zero counts. !isError because a failed
  // refetch retains the previous cached count (possibly 0) with
  // isLoading/isStale both false — an errored count is unknown, not zero.
  const isZeroMatch = !isLoading && !isStale && !isError && count === 0

  const geoPoly = useMemo(
    () => ringsToGeoJsonShape(boundaryRings),
    [boundaryRings],
  )

  // The shape's own count. It supersedes the live count from the boundary
  // step onward: once a boundary exists, the number the list will hold is
  // this one, and showing the pre-shape total on the name step would put a
  // figure on the Save button that the saved list never matches.
  const {
    count: polygonCount,
    audienceEmpty,
    isLoading: isPolygonLoading,
    isStale: isPolygonStale,
    isError: isPolygonError,
    errorMessage: polygonErrorMessage,
  } = useListWizardPolygonCount(
    geoPoly,
    backendPayload,
    !voterDataUnavailable && isConditionsStepValid,
  )

  const hasBoundary = geoPoly !== null
  const effectiveCount = hasBoundary ? polygonCount : count
  const isEffectiveCounting = hasBoundary
    ? isPolygonLoading || isPolygonStale
    : isLoading || isStale

  // Continuing with no shape at all is the point of the step being optional,
  // so only a DRAWN boundary can block: one that settles on nobody builds
  // nothing, and the step says to move it rather than refusing silently. An
  // errored or in-flight count is unknown, not zero — the same discipline
  // the conditions step's zero-match gate applies.
  // An errored count blocks too, which is the opposite of the conditions
  // step's rule and deliberately so. There the unknown is harmless — the
  // save proceeds and writes what the filters say. Here the only 400 this
  // count earns is the people cap, and the save re-runs that same scan to
  // freeze the shape's membership, so continuing on an error walks the
  // holder through naming a list that cannot be saved.
  const isBoundaryBlocked =
    hasBoundary && (isEffectiveCounting || isPolygonError || polygonCount === 0)

  // ENG-10840: the overlap strip only ever fires on a REAL selection (unlike
  // the live count above, which deliberately also fires unfiltered to show
  // the disabled CTA's full-universe total) — "no selection = no strip" is
  // one of the AC's hard gates, so isConditionsStepValid alone (not the
  // voter-file branch's always-on rule) decides whether it's enabled.
  const hasSavedLists = customSegments.length > 0
  const {
    count: overlapCount,
    isLoading: isOverlapLoading,
    isStale: isOverlapStale,
    isError: isOverlapError,
  } = useListWizardOverlapCount(
    backendPayload,
    // Never in edit mode: the overlap union counts the list being edited as
    // one of the saved lists, so an unchanged selection would report ~100%
    // already-saved. Excluding it needs an excludeSegmentId on
    // POST /v1/contacts/overlap-count, so the strip stays hidden until then.
    !voterDataUnavailable &&
      isConditionsStepValid &&
      hasSavedLists &&
      !isEditing,
  )

  // Render only once every input has settled: the live count backs the
  // percent's denominator, so an in-flight/errored live count can't produce
  // a stale or nonsensical percent. A failed overlap request (isOverlapError)
  // hides the strip entirely rather than surfacing an error — it's a passive
  // affordance, never something that blocks the CTA.
  const overlapBarProps =
    stepName === 'conditions' &&
    !isEditing &&
    isConditionsStepValid &&
    hasSavedLists &&
    !isOverlapLoading &&
    !isOverlapStale &&
    !isOverlapError &&
    overlapCount !== undefined &&
    !isLoading &&
    !isStale &&
    !isError &&
    count !== undefined
      ? {
          overlapCount,
          liveCount: count,
        }
      : null

  const handleNext = () => {
    if (stepName === 'branch' && branch) {
      trackEvent(EVENTS.Contacts.ListWizard.MethodCompleted, {
        context: isWinContext ? 'win' : 'serve',
        branch,
      })
      setStepIndex(stepIndex + 1)
    } else if (
      stepName === 'conditions' &&
      isConditionsStepValid &&
      !isZeroMatch
    ) {
      trackEvent(EVENTS.Contacts.ListWizard.ConditionsCompleted, {
        context: isWinContext ? 'win' : 'serve',
        ...(activeBranch ? { branch: activeBranch } : {}),
      })
      setStepIndex(stepIndex + 1)
    } else if (stepName === 'boundary' && !isBoundaryBlocked) {
      trackEvent(EVENTS.Contacts.ListWizard.BoundaryCompleted, {
        context: isWinContext ? 'win' : 'serve',
        hasBoundary,
      })
      setStepIndex(stepIndex + 1)
    }
  }

  const handleBack = () => {
    setStepIndex(Math.max(stepIndex - 1, 0))
  }

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      clientRequest('POST /v1/voters/voter-file/filter', payload).then(
        (res) => res.data,
      ),
    onSuccess: async (response) => {
      successSnackbar('List created successfully')
      // ENG-10709: fire exactly once per successful create, never on a
      // failed create or wizard abandon (createMutation.onError below has no
      // matching trackEvent). Gated on isWinContextReady like the other
      // product-specific events in this surface, so a not-yet-settled mode
      // can't emit the wrong variant.
      if (isWinContextReady) {
        // ENG-10767: the name stage's funnel completion — fires alongside
        // the List Created outcome events below (skill rule: a final stage
        // that both completes the funnel and produces the outcome fires
        // both; they answer different questions).
        trackEvent(EVENTS.Contacts.ListWizard.NameCompleted, {
          context: isWinContext ? 'win' : 'serve',
          ...(activeBranch ? { branch: activeBranch } : {}),
        })
        if (activeBranch === 'voterFile') {
          const variableCount =
            countSelectedFilterCategories(demographicFilters) +
            (supportStatus.length > 0 ? 1 : 0)
          trackEvent(
            isWinContext
              ? EVENTS.VoterData.ListCreated
              : EVENTS.ConstituentData.ListCreated,
            {
              variableCount,
              ...(isWinContext
                ? { hasParty: hasPartyFilterSelection(demographicFilters) }
                : {}),
            },
          )
        } else if (activeBranch === 'activity') {
          // Filtered defensively (isConditionsStepValid already guarantees
          // every row has a channel by submit time) so a stray blank row
          // can't produce an 'any' entry that didn't come from a real
          // condition.
          const validConditions = activityConditions.filter(
            (condition) => condition.outreachType !== '',
          )
          const sourceCampaign = validConditions.length
            ? validConditions
                .map((condition) => condition.outreachName ?? 'any')
                .join(', ')
            : 'any'
          // Array, not a joined string: Amplitude/HubSpot property
          // definitions allow a scalar-array custom property, and this event
          // doesn't drive a HubSpot email (see instrument-analytics-event
          // skill's flatten-for-email rule), so no flattening is needed here.
          const actionFilter = Array.from(
            new Set(validConditions.flatMap((condition) => condition.actions)),
          )
          trackEvent(
            isWinContext
              ? EVENTS.VoterData.ActivityListCreated
              : EVENTS.ConstituentData.ActivityListCreated,
            { sourceCampaign, actionFilter },
          )
        }
      }
      // A failed cache refresh must not strand the sheet open after the
      // create itself succeeded — React Query doesn't catch onSuccess
      // throws, so an unguarded rejection here would skip the close below.
      await refreshCustomSegments().catch((error) =>
        console.log('Error refreshing segments after create', error),
      )
      onOpenChange(false)
      // ENG-10707/10725: land on the new list's detail sheet instead of the
      // main table — refreshCustomSegments already invalidated
      // ['custom-segments', orgSlug], so the sheet finds this list as soon
      // as it opens. selectList is shallow, so the index stays mounted.
      // Deferred so wizardOpen(false) commits before the detail sheet opens:
      // pushState updates usePathname outside the React batch, which could
      // otherwise render a frame with both full-screen drawers stacked.
      setTimeout(() => selectList(response.id), 0)
    },
    onError: (error) => {
      // gp-api words the people-cap refusal for whoever drew the shape
      // ("Draw a smaller boundary or narrow the list"), and that message was
      // being thrown away for a generic failure. The save's own scan runs
      // UNFILTERED where the preview applies the filters, so a shape the
      // pill counted happily can still land here — which makes the real
      // message the only thing telling the holder what to do about it.
      const capMessage = boundarySaveErrorMessage(error)
      if (capMessage) {
        errorSnackbar(capMessage, { autoHideDuration: 6000 })
        return
      }
      errorSnackbar('Failed to create list')
    },
  })

  // The detail sheet's own demographics/reachability query is keyed on the
  // list id, so an edited list would keep rendering the pre-edit numbers
  // underneath. The outreach audience picker reads the same segments
  // endpoint, so it gets dropped too.
  const invalidateEditedList = async () => {
    if (!editingSegment) return
    await queryClient.invalidateQueries({
      queryKey: ['list-detail', orgSlug, editingSegment.id],
    })
    // Same reason as list-detail: re-cutting a list changes WHO is in it, and
    // the map draws the members rather than the summary.
    await queryClient.invalidateQueries({
      queryKey: listPeopleQueryKey(orgSlug, String(editingSegment.id)),
    })
    await queryClient.invalidateQueries({
      queryKey: outreachAudienceListsKey(orgSlug),
    })
  }

  const updateMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      clientRequest('PUT /v1/voters/voter-file/filter/:id', {
        id: String(editingSegment?.id),
        ...payload,
      }).then((res) => res.data),
    onSuccess: async () => {
      // ENG-10767: Segment Updated, distinguished by action — 'filters' is
      // the property the legacy FiltersSheet used for a criteria edit. Edit
      // covers renaming too, so there is no separate 'rename' variant.
      if (isWinContextReady) {
        trackEvent(EVENTS.Contacts.SegmentUpdated, {
          action: 'filters',
          context: isWinContext ? 'win' : 'serve',
        })
      }
      successSnackbar('List updated')
      // refreshCustomSegments refetches the segments query directly rather
      // than invalidating it, so a failed refetch leaves the cache holding the
      // pre-edit name and criteria — the lists index would keep showing them
      // until a full reload. Marking it stale is the floor.
      await refreshCustomSegments().catch((error) => {
        console.log('Error refreshing segments after update', error)
        queryClient.invalidateQueries({
          queryKey: ['custom-segments', orgSlug],
        })
      })
      await invalidateEditedList()
      onOpenChange(false)
      // Back to the list's own detail sheet, the surface the edit was
      // launched from — deferred for the same reason the create path defers
      // selectList: pushState lands outside the React batch, so opening it
      // synchronously could render a frame with both drawers stacked.
      if (editingSegment) {
        const editedId = editingSegment.id
        setTimeout(() => selectList(editedId), 0)
      }
    },
    onError: async (error: unknown) => {
      // ENG-10703 stamps firstUsedForOutreachAt atomically, so outreach can
      // lock this list while the sheet is open — that race lands in the
      // now-locked messaging, not a generic failure toast.
      if (error instanceof FetchError && error.status === 409) {
        errorSnackbar(LOCKED_LIST_MESSAGE, { autoHideDuration: 6000 })
        await refreshCustomSegments().catch((refreshError) =>
          console.log('Error refreshing segments after lock', refreshError),
        )
        onOpenChange(false)
        return
      }
      errorSnackbar('Failed to update list')
    },
  })

  const trimmedName = name.trim()
  // !isLoading && !isStale: a save that races the debounced count would omit
  // voterCount and let the server default it to 0 — the exact display bug
  // ENG-10769 fixes. isStale also blocks the window where a payload change is
  // still awaiting the debounce, so Save can't enable on a superseded count
  // and then re-disable when the trailing refetch lands (that flicker let a
  // click slip through onto a disabled button under load). A failed count
  // still submits once settled (count stays a nice-to-have).
  // Reads the shape's count once there is a shape, for the same reason the
  // name step displays it: saving against the pre-boundary count would write
  // a voterCount the list never matches. A boundary that holds nobody blocks
  // Save here too — the boundary step already refuses it, but a name step
  // reached before a slower count landed must not let it through.
  const canSubmitName =
    trimmedName.length > 0 && !isLoading && !isStale && !isBoundaryBlocked
  const canSubmit = canSubmitName && !createMutation.isPending

  const handleSubmit = () => {
    if (!canSubmit) return
    createMutation.mutate({
      name: trimmedName,
      ...backendPayload,
      ...(geoPoly ? { geoPoly } : {}),
    })
  }

  // Edit's single screen has to clear both gates at once — the name step's
  // (a name, a settled count) and the conditions step's (a real, non-empty
  // selection) — since there's no second step left to enforce the latter.
  const canSaveEdit =
    canSubmitName &&
    !updateMutation.isPending &&
    isConditionsStepValid &&
    !isZeroMatch

  const handleSaveEdit = () => {
    if (!canSaveEdit) return
    updateMutation.mutate({
      name: trimmedName,
      ...backendPayload,
    })
  }

  const peopleNoun = isWinContext ? 'voters' : 'constituents'
  const labels = getContactsLabels(isWinContext)

  // Lovable-locked titles (ENG-10725): the branch and name steps are
  // mode-neutral; the conditions step shares ONE heading across both
  // branches — "Build a voter list" / "Build a constituent list" (via
  // contactsLabels.ts, the one place that copy lives), matching the
  // prototype's single step-2 title.
  const stepTitle = isEditing
    ? 'Edit list'
    : stepName === 'branch'
      ? 'How do you want to build this list?'
      : stepName === 'boundary'
        ? labels.boundaryStepTitle
        : stepName === 'name'
          ? 'Name your list'
          : labels.wizardVoterFileStepTitle

  const saveChangesLabel =
    isLoading || isStale || count === undefined
      ? 'Save changes'
      : `Save changes (${count.toLocaleString()})`

  // The label hides the number whenever there's no trustworthy CURRENT
  // count — mid-fetch, still debouncing, or never resolved (including a
  // terminal error, since we can't format undefined either way).
  // isLoading/isStale always hide it regardless of isError: a refetch of a
  // previously-errored query can have isFetching and isError both true at
  // once, and that's still a real in-flight fetch.
  const buildLabel =
    isLoading || isStale || count === undefined
      ? 'Build your list'
      : `Build your list (${count.toLocaleString()})`
  // isZeroMatch above excludes isError because a failed refetch's count is
  // unknown, not a real value — the same discipline applies here: without
  // `&& !isError`, a query that errors on its very first fetch (no prior
  // successful count) leaves `count` undefined forever, so the CTA would be
  // stuck showing the loading spinner permanently instead of settling into
  // the errored "Build your list" guidance state.
  const isCounting = isLoading || isStale || (count === undefined && !isError)

  return (
    <CrmSheet
      open={open}
      onOpenChange={onOpenChange}
      onBack={stepIndex > 0 ? handleBack : undefined}
      bodyRef={bodyRef}
      banner={
        stepName === 'conditions' && overlapBarProps ? (
          <OverlapBar {...overlapBarProps} peopleNoun={peopleNoun} />
        ) : undefined
      }
      header={
        isEditing ? (
          // Edit is a single-step surface — no stepper, no overline slot:
          // the visible DrawerTitle stays as the flow's identity and
          // the name input takes the stepper's place.
          <>
            <DrawerTitle className="text-base font-semibold">
              Edit list
            </DrawerTitle>
            <Input
              aria-label="List name"
              value={name}
              onChange={(event) =>
                setName(event.target.value.slice(0, MAX_SEGMENT_NAME_LENGTH))
              }
              maxLength={MAX_SEGMENT_NAME_LENGTH}
              placeholder="Name this list"
            />
          </>
        ) : (
          // Create flow: the Stepper renders the visible overline and the
          // bars. DrawerTitle stays sr-only for the drawer's accessible
          // name (no `onExit` — CrmSheet's own close chrome handles it).
          <>
            <DrawerTitle className="sr-only">Create new list</DrawerTitle>
            <Stepper
              variant="bar"
              currentStep={stepIndex + 1}
              totalSteps={steps.length}
              overline="Create new list"
            />
          </>
        )
      }
      footer={
        <>
          {stepName === 'branch' && (
            <Button
              type="button"
              className="w-full text-sm"
              onClick={handleNext}
              disabled={!branch}
            >
              Continue
            </Button>
          )}
          {stepName === 'conditions' &&
            (isEditing ? (
              <Button
                type="button"
                className="w-full text-sm"
                onClick={handleSaveEdit}
                disabled={!canSaveEdit}
                loading={updateMutation.isPending || isCounting}
              >
                {saveChangesLabel}
              </Button>
            ) : (
              <Button
                type="button"
                className="w-full text-sm"
                onClick={handleNext}
                disabled={!isConditionsStepValid || isZeroMatch}
                loading={isCounting}
              >
                {buildLabel}
              </Button>
            ))}
          {stepName === 'boundary' && (
            <Button
              type="button"
              className="w-full text-sm"
              onClick={handleNext}
              disabled={isBoundaryBlocked}
              loading={hasBoundary && isEffectiveCounting}
            >
              Continue
            </Button>
          )}
          {stepName === 'name' && (
            <Button
              type="button"
              className="w-full text-sm"
              onClick={handleSubmit}
              disabled={!canSubmit}
              loading={createMutation.isPending}
            >
              Save list
            </Button>
          )}
        </>
      }
    >
      {/* Step title lives in the body now — matches the outreach shell's
          <Intro> shape (h3 + optional body p). Skipped in edit mode: the
          header already reads "Edit list" and there is no per-step title
          to add here. */}
      {!isEditing && (
        <h3 className="mb-6 text-2xl font-semibold text-foreground">
          {stepTitle}
        </h3>
      )}
      {stepName === 'branch' && (
        <BranchStep
          selected={branch}
          onSelect={setBranch}
          isWinContext={isWinContext}
        />
      )}
      {stepName === 'conditions' && activeBranch === 'voterFile' && (
        <VoterFileStep
          filters={demographicFilters}
          onFiltersChange={setDemographicFilters}
          supportStatus={supportStatus}
          onSupportStatusChange={setSupportStatus}
          precincts={precincts}
          onPrecinctsChange={setPrecincts}
          precinctOptions={precinctOptions}
          isElectedOfficial={isElectedOfficial}
          showRecommendedListFilters
        />
      )}
      {stepName === 'conditions' && activeBranch === 'activity' && (
        <ActivityStep
          conditions={activityConditions}
          onChange={setActivityConditions}
        />
      )}
      {stepName === 'boundary' && (
        <BoundaryStep
          rings={boundaryRings}
          activeIndex={boundaryActiveIndex}
          onRingsChange={setBoundaryRings}
          onActiveIndexChange={setBoundaryActiveIndex}
          labels={labels}
          filters={backendPayload}
          count={polygonCount}
          audienceEmpty={audienceEmpty}
          isCounting={isPolygonLoading || isPolygonStale}
          isError={isPolygonError}
          errorMessage={polygonErrorMessage}
          enabled={!voterDataUnavailable}
        />
      )}
      {stepName === 'name' && (
        <NameStep
          name={name}
          onNameChange={setName}
          count={effectiveCount}
          // isStale too: while a filter change is still debouncing the count
          // is stale for the current selection and Save is gated off, so the
          // sentence must read "Counting…" rather than assert a stale total.
          isCounting={isEffectiveCounting}
          isCapError={isCapError || Boolean(polygonErrorMessage)}
          countErrorMessage={polygonErrorMessage ?? errorMessage}
          peopleNoun={peopleNoun}
        />
      )}
    </CrmSheet>
  )
}
