'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FetchError } from 'ofetch'
import { DoorKnockingMode, DoorKnockingTurf } from '@goodparty_org/contracts'
import {
  Button,
  IconButton,
  PencilIcon,
  ToggleGroup,
  ToggleGroupItem,
  Trash2Icon,
  XMarkIcon,
} from '@styleguide'
import { clientRequest } from 'gpApi/typed-request'
import { useSnackbar } from 'helpers/useSnackbar'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import { ConfirmDeleteDialog } from 'app/dashboard/shared/ConfirmDeleteDialog'
import EditTurfDialog from './EditTurfDialog'
import filterSections from 'app/dashboard/contacts/[[...attr]]/components/configs/filters.config'
import { LANGUAGE_KEY_TO_CODE } from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import {
  routeQueryOptions,
  savedListsQueryOptions,
  turfsQueryOptions,
} from './turfQueries'
import { DOORS_PER_HOUR, estimateWalkTime } from './walkEstimate'
import { estimateTravelSeconds } from './travelMode'
import { unpreviewableDisclosureLabels } from './createFlow/voterFilterPreview'
import type { PolygonStats } from './filterEngine'
import { countDoors, knockableTargets } from '../routeCounts'

// gp-api refuses to delete a knocked turf: doorKnockingTurf.delete runs
// assertNotLocked first, and lockedness IS the frozen route row, so a turf
// with logged knocks 409s. The affordance follows that rule rather than
// duplicating it — and the 409 is still handled, since a teammate can knock
// the turf while this sheet is open.
const LOCKED_TURF_MESSAGE =
  'This list has already been knocked, so its route is frozen and it can no longer be deleted.'

// option key -> pill label, straight from the sections config the create
// flow renders, so Details always speaks the same vocabulary.
const OPTION_LABELS: Record<string, string> = Object.fromEntries(
  filterSections.flatMap((section) =>
    section.fields.flatMap((field) =>
      field.options.map((option) => [option.key, option.label]),
    ),
  ),
)

const MODE_LABEL: Record<DoorKnockingMode, string> = {
  walk: 'Walking',
  drive: 'Driving',
}

const TRAVEL_MODE_PILL_CLASSNAME =
  'rounded-full border border-components-input-border bg-transparent px-3 py-1 text-xs font-normal text-foreground data-[state=on]:border-tertiary-dark data-[state=on]:bg-tertiary-dark data-[state=on]:text-tertiary-foreground data-[state=on]:hover:bg-tertiary-dark/90'

const formatDuration = (seconds: number): string => {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

const Stat = ({
  label,
  value,
  hint,
  pending,
}: {
  label: string
  value: string
  hint?: string
  pending?: boolean
}) => (
  <div className="rounded-lg border border-border p-3">
    <p className="text-xs text-muted-foreground">{label}</p>
    {pending ? (
      <p className="py-0.5">
        <span className="block h-4 w-20 animate-pulse rounded bg-muted" />
        <span className="sr-only">Loading</span>
      </p>
    ) : (
      <p className="text-sm font-semibold">{value}</p>
    )}
    {hint && !pending && (
      <p className="text-xs text-muted-foreground">{hint}</p>
    )}
  </div>
)

interface TurfDetailsSheetProps {
  turf: DoorKnockingTurf
  // This list's own audience inside its polygon — the page runs the same
  // computation the draw step ran against the same shape and the same saved
  // filters, so these reproduce the numbers the list was committed against.
  // Unshadeable filters (age 65+) leave it a superset, exactly as the draw
  // step disclosed at that moment; knock-time evaluation stays canonical.
  listStats: PolygonStats | null
  // The pack these are computed from is still decoding, so a null `listStats`
  // does not yet mean "no doors in this shape" — without this the sheet reads
  // 0 doors and 'Not knocked yet' until the pack lands, which is exactly the
  // confident-but-wrong answer the locked branch already guards against.
  listStatsPending: boolean
  // This list's OWN selections the pack has no bucket for, recomputed by the
  // page from the saved filters — not the create flow's draft-derived value,
  // which describes whatever is being drawn right now.
  //
  // The filter itself works: gp-api's voterFileFilter.utils.ts turns age65Plus
  // into a real `{ min: 65 }` bound at knock time. What can't express it is the
  // PREVIEW — age65Plus has no FILTER_KEY_TO_DIM entry (mapping it onto the
  // 50_plus bucket was rejected, since two pills would then preview one
  // cohort), so filtersToDimSelections adds no age constraint and these counts
  // span every age. So the disclosure is about what the map can shade, never
  // about the targeting: a candidate who reads it as "my filter isn't applied"
  // has been told something worse than the imprecision it exists to fix.
  unpreviewableKeys: string[]
  onClose: () => void
  // The page holds its own references to this turf (map scope, camera focus),
  // which would otherwise keep masking the map to a list that no longer
  // exists.
  onDeleted: (turf: DoorKnockingTurf) => void
}

export default function TurfDetailsSheet({
  turf,
  listStats,
  listStatsPending,
  unpreviewableKeys,
  onClose,
  onDeleted,
}: TurfDetailsSheetProps) {
  const queryClient = useQueryClient()
  const { successSnackbar, errorSnackbar } = useSnackbar()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // Which mode the travel figure is being read in. Display-only and
  // deliberately never persisted: door_knocking_route.doorKnockingTurfId is
  // unique, the row is never written after the knock transaction commits (both
  // lockedness and knock idempotency ARE its existence), and every logged knock
  // hangs off a stopTargetId belonging to its stops. So this changes the label
  // and the estimate, and nothing else — same stops, same order, and the same
  // stored pathGeometry, which belongs to the mode we actually bought.
  const [travelModeView, setTravelModeView] = useState<DoorKnockingMode | null>(
    null,
  )
  // `turf` is a snapshot the page captured when the row was clicked, so its
  // `locked` never moves on its own. Reading the live row keeps the affordance
  // honest after a refetch — the page already runs this query, so React Query
  // serves it from cache rather than fetching twice. Rule of thumb: liveTurf
  // for anything that gates behavior or that this surface can edit — name and
  // color both, now that EditTurfDialog writes them, or the header would keep
  // showing the old name after a rename — and the prop for identity (id,
  // filter id), which no edit can change.
  const turfsQuery = useQuery(turfsQueryOptions)
  const liveTurf =
    turfsQuery.data?.find((candidate) => candidate.id === turf.id) ?? turf
  const deleteTurf = useMutation({
    mutationFn: () =>
      clientRequest('DELETE /v1/door-knocking/turfs/:id', {
        id: String(turf.id),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: turfsQueryOptions.queryKey,
      })
      trackEvent(EVENTS.DoorKnocking.ListDeleted, { turfId: turf.id })
      successSnackbar('List deleted')
      setConfirmOpen(false)
      onDeleted(turf)
    },
    onError: async (error) => {
      if (error instanceof FetchError && error.status === 409) {
        // Someone knocked it while this sheet was open, so this is permanent,
        // not retryable: close the confirm rather than leaving an enabled
        // Delete that can only 409 again, and explain in a snackbar that
        // outlives the dialog. The refetch then flips liveTurf.locked and the
        // trigger retires itself.
        setConfirmOpen(false)
        setDeleteError(null)
        errorSnackbar(LOCKED_TURF_MESSAGE, { autoHideDuration: 6000 })
        await queryClient.invalidateQueries({
          queryKey: turfsQueryOptions.queryKey,
        })
        return
      }
      // Generic failures are worth retrying, so the dialog stays put.
      setDeleteError('The list could not be deleted. Try again.')
    },
  })
  const routeQuery = useQuery({
    ...routeQueryOptions(turf.id),
    // liveTurf, not the prop: a turf knocked while this sheet is open has real
    // route data, and gating on the snapshot would keep every stat reading
    // 'Not knocked yet'.
    enabled: liveTurf.locked,
  })
  const listsQuery = useQuery(savedListsQueryOptions)
  const filter = listsQuery.data?.find(
    (list) => list.id === turf.voterFileFilterId,
  )
  // Language selections persist as codes ('en'), not booleans — re-expand
  // them to their option labels like the boolean keys.
  const languageLabels = (
    (filter?.languageCodes as string[] | undefined) ?? []
  ).flatMap((code) => {
    const key = Object.entries(LANGUAGE_KEY_TO_CODE).find(
      ([, candidate]) => candidate === code,
    )?.[0]
    const label = key ? OPTION_LABELS[key] : undefined
    return label ? [label] : []
  })
  const appliedFilterLabels = filter
    ? Object.entries(OPTION_LABELS)
        .filter(([key]) => filter[key] === true)
        .map(([, label]) => label)
        .concat((filter.incomeRanges as string[] | undefined) ?? [])
        .concat(languageLabels)
    : []

  const route = routeQuery.data
  const targets = knockableTargets(route?.stops ?? [])
  // Every non-'unknown' status is an outcome somebody recorded, but three of
  // them (not home, inaccessible, refused) are doors where no conversation
  // happened — so these are the knockable people LOGGED, and calling them
  // reached would credit the walk with conversations it didn't have.
  const logged = targets.filter(
    (target) => target.knockStatus !== 'unknown',
  ).length
  // Lockedness IS the frozen route row, so a locked turf has a route by
  // construction: until it arrives, every route-derived stat is loading or
  // broken — never 'Not knocked yet'. Rendering the pre-route copy through
  // the fetch told a candidate their walked list had never been touched, and
  // on a failed fetch it said so permanently.
  const routePending = liveTurf.locked && !route && !routeQuery.isError
  const routeFailed = liveTurf.locked && routeQuery.isError
  // Doors are addresses, so both branches count households rather than the
  // coordinates the router visits: the frozen route's addresses once it
  // exists, otherwise the ones the pack puts inside the polygon. A stop at a
  // multi-unit building is many doors.
  const doors = route ? countDoors(route.stops) : (listStats?.households ?? 0)
  // The one number a candidate wants while deciding whether a saved list is a
  // reasonable evening — and it has to be answerable before the route exists,
  // because building one is a billed, irreversible Geoapify call. Same rule of
  // thumb the draw step quotes, off the same door count, so the two surfaces
  // can't disagree about the same shape. Only ever the unlocked answer: a
  // locked turf's own duration is on its way.
  const preRouteEstimate =
    !liveTurf.locked && !listStatsPending && doors > 0
      ? `About ${estimateWalkTime(doors)}`
      : null
  // The unlocked mirror of routePending: an unlocked turf's numbers come from
  // the pack, which decodes on its own schedule.
  const preRoutePending = !liveTurf.locked && listStatsPending
  // And of routeFailed. Settled with nothing to show means one of the two
  // inputs never arrived — or the list was deleted out from under the turf —
  // so there is no audience to report. `0 doors` would be a real answer to a
  // question we cannot answer.
  const preRouteFailed = !liveTurf.locked && !listStatsPending && !listStats
  // A route-derived stat has three states before it has a value. Spread into
  // Stat so they agree about which one they're in.
  const routeStat = (value: string) => ({
    pending: routePending,
    value: routeFailed ? 'Unavailable' : value,
  })
  // Doors, people and the knocking estimate are read off the pack until a
  // route exists, so they wait on it too. Route type and progress are known
  // from lockedness alone — 'Not knocked yet' needs no data to be true — so
  // they stay put rather than flickering a skeleton at every open.
  const packBackedStat = (value: string) => ({
    pending: routePending || preRoutePending,
    value: routeFailed || preRouteFailed ? 'Unavailable' : value,
  })
  // The frozen route's counts came through knock-time evaluation, so they are
  // the audience — exact, and nothing to hedge. The pack's are a superset: it
  // shades what it has buckets for, and knocking then applies the rest. So
  // "about" belongs to the pre-route branch only.
  const approximate = (count: number) =>
    liveTurf.locked ? count.toLocaleString() : `About ${count.toLocaleString()}`
  const unpreviewableLabels = unpreviewableDisclosureLabels(unpreviewableKeys)
  // Only the pre-route counts are the pack's, and only a settled count can be
  // qualified — a skeleton and an 'Unavailable' have nothing to be about.
  const discloseApproximation =
    !liveTurf.locked && !preRoutePending && !preRouteFailed

  const builtMode = route?.route.mode ?? null
  const shownMode = travelModeView ?? builtMode
  // Reading the travel figure in the mode we did NOT buy. The distance is the
  // bought path's, so this is that same path at a different speed — never a
  // second route, which is why nothing here recomputes stops or geometry.
  const flippedFromBuilt =
    builtMode !== null && shownMode !== null && shownMode !== builtMode
  const travelSeconds =
    route && flippedFromBuilt && shownMode
      ? estimateTravelSeconds(route.route.totalMeters, shownMode)
      : (route?.route.totalSeconds ?? 0)

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-background">
      <div className="border-b border-border px-6 py-4">
        <div className="mx-auto flex w-full max-w-2xl items-start gap-3">
          <span
            className="mt-1.5 h-3 w-3 shrink-0 rounded-full"
            style={{ backgroundColor: liveTurf.color }}
          />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold">{liveTurf.name}</h2>
            <p className="text-sm text-muted-foreground">
              Overview of this list, its route, and applied filters.
            </p>
          </div>
          {/* Paper without opening the walk first, same rule and same markup
              as the TurfList row: only a locked list has a route to print, so
              the link would 404 on an unknocked one — and the file is built by
              a route handler, so a plain link costs this bundle nothing. */}
          {liveTurf.locked && (
            <a
              href={`/dashboard/door-knocking/print/${turf.id}/pdf`}
              className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-medium underline-offset-2 hover:bg-muted/50 hover:underline"
            >
              PDF
            </a>
          )}
          {/* Same lock rule as Delete, for the same reason: gp-api's update
              asserts not-locked because the endpoint also accepts geoPoly, and
              the polygon is what the frozen route was computed from. */}
          {!liveTurf.locked && (
            <Button
              size="small"
              variant="outline"
              aria-label={`Edit ${liveTurf.name}`}
              className="shrink-0"
              onClick={() => setEditOpen(true)}
            >
              <PencilIcon size={14} />
              Edit
            </Button>
          )}
          {!liveTurf.locked && (
            <Button
              size="small"
              variant="outline"
              // Named for the turf so it doesn't collide with the confirm
              // dialog's own "Delete", for screen readers and tests alike.
              aria-label={`Delete ${liveTurf.name}`}
              className="shrink-0 text-destructive hover:bg-destructive/10"
              onClick={() => {
                setDeleteError(null)
                setConfirmOpen(true)
              }}
            >
              <Trash2Icon size={14} />
              Delete
            </Button>
          )}
          <IconButton aria-label="Close details" onClick={onClose}>
            <XMarkIcon size={18} />
          </IconButton>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-info">
              Overview
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {/* Both branches describe this list's audience now that the
                  pre-route one is computed with the turf's saved filters, so
                  the labels no longer have to hedge about which population
                  they mean — which is the whole point, sitting as they do
                  directly above the "Applied filters" pills. A locked turf's
                  authoritative counts are the frozen route's, so these wait
                  for it rather than showing the pack's answer and then
                  swapping it out mid-load. */}
              <Stat label="Doors" {...packBackedStat(approximate(doors))} />
              {/* Gated on the route existing, not on the count being
                  non-zero: ADR 0007 drops do-not-knock residents, so a route
                  whose every resident is flagged has 0 knockable people, and
                  falling back on emptiness would answer that with the pack's
                  pre-route number instead of the frozen route's real 0. */}
              <Stat
                label="People"
                {...packBackedStat(
                  approximate(
                    route ? targets.length : (listStats?.people ?? 0),
                  ),
                )}
              />
              {/* Two different quantities, so two labels rather than one that
                  is a lie for one of them. Geoapify's totalSeconds is the
                  agent plan's travel time and the jobs we send it carry no
                  per-stop duration, so it is the walk between doors with zero
                  time spent AT them — "Estimated time" read as the cost of the
                  evening and undersold it by more than half. The pre-route
                  number is the opposite: 45 doors an hour is a sustained
                  knocking pace, conversations included. Mode is already on the
                  "Route type" stat next door, and is unknown while the route
                  is still loading, so this label stays mode-free. */}
              <Stat
                label={liveTurf.locked ? 'Travel time' : 'Knocking time'}
                {...packBackedStat(
                  route
                    ? flippedFromBuilt
                      ? `About ${formatDuration(travelSeconds)}`
                      : formatDuration(travelSeconds)
                    : (preRouteEstimate ?? 'Not knocked yet'),
                )}
                // Naming the rate is what keeps the pre-route number a rule of
                // thumb rather than a promise; Geoapify's own duration needs
                // no caveat beyond its label. Read in the mode we didn't buy it
                // stops being the vendor's answer, so it says whose it is.
                hint={
                  preRouteEstimate
                    ? `at ${DOORS_PER_HOUR} doors an hour`
                    : flippedFromBuilt && shownMode
                      ? `our estimate, at ${MODE_LABEL[shownMode].toLowerCase()} speed`
                      : undefined
                }
              />
              <Stat
                label="Route type"
                {...routeStat(
                  route
                    ? `${route.route.mode === 'walk' ? 'Walk' : 'Drive'} route${
                        route.route.loop ? ' · loop' : ''
                      }`
                    : 'Not knocked yet',
                )}
              />
              <Stat
                label="Created"
                value={new Date(turf.createdAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              />
              {/* Logged, not reached: not-home, inaccessible and refused all
                  count here, and none of them is a conversation. */}
              <Stat
                label="People logged"
                {...routeStat(
                  route
                    ? `${logged} of ${targets.length} · ${
                        targets.length > 0
                          ? Math.round((logged / targets.length) * 100)
                          : 0
                      }%`
                    : 'Not knocked yet',
                )}
              />
            </div>
            {/* The route is frozen, so this is a reading of it and not an edit
                to it: the stops, their order and the drawn path are the ones
                bought for `builtMode` and stay exactly as they are. Nothing
                here writes, and the map is not even on this surface — the only
                thing that moves is the figure above and its label. */}
            {route && route.route.totalMeters > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Travel time for
                </span>
                <ToggleGroup
                  type="single"
                  // A defined value always, and one of the two is always on:
                  // Radix reports '' for a press that would deselect, which
                  // here would leave the figure with no mode to be in.
                  value={shownMode ?? ''}
                  onValueChange={(next) => {
                    if (next === 'walk' || next === 'drive')
                      setTravelModeView(next)
                  }}
                  aria-label="Travel time for"
                  className="flex flex-wrap justify-start gap-1.5"
                >
                  <ToggleGroupItem
                    value="walk"
                    className={TRAVEL_MODE_PILL_CLASSNAME}
                  >
                    {MODE_LABEL.walk}
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="drive"
                    className={TRAVEL_MODE_PILL_CLASSNAME}
                  >
                    {MODE_LABEL.drive}
                  </ToggleGroupItem>
                </ToggleGroup>
                {flippedFromBuilt && shownMode && builtMode && (
                  // One template literal rather than JSX text around
                  // expressions: SWC/Turbopack drops the leading space of a
                  // text node following an expression, which jsdom keeps — so
                  // the mixed form ships punctuation and spacing the unit test
                  // never sees.
                  <p className="text-xs text-muted-foreground">
                    {`This route was built for ${MODE_LABEL[
                      builtMode
                    ].toLowerCase()}, and those are the only directions we bought. Nothing has been re-planned: the stops, their order and the path on the map are unchanged. This is our own estimate of covering that same path at ${MODE_LABEL[
                      shownMode
                    ].toLowerCase()} speed.`}
                  </p>
                )}
              </div>
            )}
            {routeFailed && (
              <p className="text-sm text-destructive">
                This list&rsquo;s route could not be loaded, so the numbers
                above are unavailable. Refresh to try again — nothing about the
                route or the knocks logged against it has changed.
              </p>
            )}
            {preRouteFailed && (
              <p className="text-sm text-destructive">
                This list&rsquo;s audience could not be counted, so the numbers
                above are unavailable. Refresh to try again — the filters below
                are what the list will target either way.
              </p>
            )}
            {/* Word for word the landing rail's pair of lines (ENG-10899), on
                the surface that reports the same numbers about the same list —
                a candidate who reads the rail and then opens Details must not
                meet two differently-worded accounts of one caveat.

                "About" is not a hedge on the arithmetic: the count is exact for
                what the pack can compute and a superset of who gets knocked.
                The gap belongs to the PREVIEW, never to the filter — a key the
                pack has no bucket for adds no entry to its dim at all, so a 65+
                list shades every age, while gp-api's own conversion bounds it at
                `{ gte: 65 }` and knocks exactly who was asked for. So the copy
                says the map can't show the filter, never that the filter isn't
                applied, which would read as targeting silently failing and is
                the worse misunderstanding. */}
            {discloseApproximation && (
              <p className="text-xs text-muted-foreground">
                About, because the map can&rsquo;t show every filter this list
                applies, and knocking also skips anyone marked do-not-knock or
                &ldquo;not a voter&rdquo; — so you&rsquo;ll walk fewer doors
                than this.
              </p>
            )}
            {/* The draw step's own sentence, from the same helper, so the
                filter isn't named one way while drawing and another here. */}
            {discloseApproximation && unpreviewableLabels.length > 0 && (
              <p className="text-xs text-muted-foreground">
                The map can&rsquo;t shade by {unpreviewableLabels.join(', ')}{' '}
                yet, so these counts include people that filter will exclude.
                Your saved list still applies it when you knock.
              </p>
            )}
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-info">
              Applied filters
            </h3>
            {appliedFilterLabels.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No filters applied — this list targets all contacts.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {/* Labels repeat across fields — 'Unknown' is an option on 11 of
                    them — so the label alone isn't a stable key. */}
                {appliedFilterLabels.map((label, index) => (
                  <span
                    key={`${label}-${index}`}
                    className="rounded-full border border-border px-2.5 py-1 text-xs"
                  >
                    {label}
                  </span>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
      <EditTurfDialog
        turf={liveTurf}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
      <ConfirmDeleteDialog
        open={confirmOpen}
        onOpenChange={(next) => {
          setConfirmOpen(next)
          if (!next) setDeleteError(null)
        }}
        title={`Delete ${liveTurf.name}?`}
        description="The drawn area and its filters are removed for good. The saved list stays in Contacts, and no logged knocks are affected."
        onConfirm={() => deleteTurf.mutate()}
        confirming={deleteTurf.isPending}
        errorMessage={deleteError}
      />
    </div>
  )
}
