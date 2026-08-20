'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DoorKnockingMode, DoorKnockingTurf } from '@goodparty_org/contracts'
import {
  Button,
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  DoorOpenIcon,
  IconButton,
  MapPinIcon,
  PencilIcon,
  ToggleGroup,
  ToggleGroupItem,
  UsersIcon,
  XMarkIcon,
} from '@styleguide'
import EditTurfDialog from './EditTurfDialog'
import filterSections, {
  legacyAgeOptions,
} from 'app/dashboard/contacts/[[...attr]]/components/configs/filters.config'
import { LANGUAGE_KEY_TO_CODE } from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import {
  routeQueryOptions,
  savedListsQueryOptions,
  turfsQueryOptions,
} from './turfQueries'
import { DOORS_PER_HOUR, estimateWalkTime } from './walkEstimate'
import { estimateTravelSeconds } from './travelMode'
import { unpreviewableDisclosureLabels } from './createFlow/voterFilterPreview'
import type { DimSlice, PolygonStats } from './filterEngine'
import { ageBucketLabel, routeAudienceMix } from './audienceMix'
import DeleteTurfControl, { LOCKED_TURF_MESSAGE } from './DeleteTurfControl'
import TurfRoster from './TurfRoster'
import { countDoors, knockableTargets } from '../routeCounts'

// The age field's own options plus the retired overlapping ranges ENG-10752
// replaced. The pickers only offer the new ones, but a list saved before that
// change still carries the old keys, and a config-only reading of this map has
// no entry for them — so an age-only legacy list rendered its pills as though
// it filtered on nothing. `ListFilterSummary` reads them for the same reason.
const optionsForField = (field: {
  key: string
  options: { key: string; label: string }[]
}) =>
  field.key === 'age' ? [...field.options, ...legacyAgeOptions] : field.options

// option key -> pill label, straight from the sections config the create
// flow renders, so Details always speaks the same vocabulary.
const OPTION_LABELS: Record<string, string> = Object.fromEntries(
  filterSections.flatMap((section) =>
    section.fields.flatMap((field) =>
      optionsForField(field).map((option) => [option.key, option.label]),
    ),
  ),
)

// option key -> the field it belongs to ('Age', 'Political Party'), from the
// same config. The pills were a single undifferentiated wrap, which is legible
// for 'Democrat' and meaningless for 'Unknown' and 'Yes' — 'Unknown' is an
// option on eleven of these fields and 'Yes' on four, so a list filtered to
// veterans with an unknown homeowner flag rendered as "Yes, Unknown" and named
// neither. Grouping is how the create flow presents the same choices, so a
// candidate reads their list back in the shape they picked it.
const OPTION_FIELD_LABELS: Record<string, string> = Object.fromEntries(
  filterSections.flatMap((section) =>
    section.fields.flatMap((field) =>
      optionsForField(field).map((option) => [option.key, field.label]),
    ),
  ),
)

// Field order follows the config rather than insertion order, so two lists
// with the same filters can't list them in different orders.
const FIELD_ORDER: string[] = filterSections.flatMap((section) =>
  section.fields.map((field) => field.label),
)

// Income ranges persist as the range strings themselves rather than as option
// keys, so their group is looked up by field instead of per value.
const INCOME_FIELD_LABEL =
  filterSections
    .flatMap((section) => section.fields)
    .find((field) => field.key === 'income_ranges')?.label ?? 'Household Income'

const groupByField = (
  entries: { field: string; label: string }[],
): { field: string; labels: string[] }[] =>
  FIELD_ORDER.flatMap((field) => {
    const labels = entries
      .filter((entry) => entry.field === field)
      .map((entry) => entry.label)
    return labels.length > 0 ? [{ field, labels }] : []
  })

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

// Every stat carries the icon for the quantity it reports. Six unlabelled
// numbers in a two-column grid are read by scanning the labels; the glyph is
// what makes a grid scannable, and it is the same one the quantity carries
// elsewhere in the product (a door for doors, people for people, a clock for
// time). Decorative on purpose — `aria-hidden`, because the label beside it
// already names the figure and a screen reader repeating "door" adds nothing.
const Stat = ({
  icon: Icon,
  label,
  value,
  hint,
  pending,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>
  label: string
  value: string
  hint?: string
  pending?: boolean
}) => (
  <div className="flex items-start gap-2 rounded-lg border border-border p-3">
    <Icon
      size={16}
      aria-hidden="true"
      className="mt-0.5 shrink-0 text-muted-foreground"
    />
    <div className="min-w-0 flex-1">
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
  </div>
)

// What the resulting audience IS, next to the "Applied filters" pills that say
// what was ASKED FOR. Percentages are of the slices' own total rather than of
// the People stat, so the bars always sum to 100% of the thing being broken
// down — a pre-route mix is computed over the same pack pass as People, and a
// post-route one over the same knockable targets, so the two agree anyway.
const Breakdown = ({
  title,
  slices,
  format,
}: {
  title: string
  slices: DimSlice[]
  format?: (label: string) => string
}) => {
  const total = slices.reduce((sum, slice) => sum + slice.people, 0)
  if (total === 0) return null
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <ul className="flex flex-col gap-1.5">
        {slices.map((slice) => {
          const percent = Math.round((slice.people / total) * 100)
          // Both sources drop empty buckets, so every slice here holds at
          // least one person — and one person in a list of 201 rounds to
          // zero. "1 · 0%" is a row contradicting itself, and a 0%-wide bar
          // reads as a rendering fault rather than as a small number, so the
          // percent floors at "<1" and the bar at a visible sliver.
          const percentLabel = percent === 0 ? '<1' : String(percent)
          const barWidth = Math.max(percent, 1)
          return (
            <li key={slice.label} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate">
                  {format ? format(slice.label) : slice.label}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {`${slice.people.toLocaleString()} · ${percentLabel}%`}
                </span>
              </div>
              <span
                aria-hidden="true"
                className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
              >
                <span
                  className="block h-full rounded-full bg-tertiary-dark"
                  style={{ width: `${barWidth}%` }}
                />
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

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
  const [editOpen, setEditOpen] = useState(false)
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
  const languageEntries = (
    (filter?.languageCodes as string[] | undefined) ?? []
  ).flatMap((code) => {
    const key = Object.entries(LANGUAGE_KEY_TO_CODE).find(
      ([, candidate]) => candidate === code,
    )?.[0]
    const label = key ? OPTION_LABELS[key] : undefined
    return label && key
      ? [{ field: OPTION_FIELD_LABELS[key] ?? 'Language', label }]
      : []
  })
  const appliedFilterEntries = filter
    ? Object.entries(OPTION_LABELS)
        .filter(([key]) => filter[key] === true)
        .map(([key, label]) => ({
          field: OPTION_FIELD_LABELS[key] ?? 'Other',
          label,
        }))
        .concat(
          ((filter.incomeRanges as string[] | undefined) ?? []).map(
            (range) => ({ field: INCOME_FIELD_LABEL, label: range }),
          ),
        )
        .concat(languageEntries)
    : []
  const appliedFilterGroups = groupByField(appliedFilterEntries)

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

  // The audience's own shape, on the same split every other figure here
  // follows: the frozen route once there is one (exact, and drawn from the
  // knockable targets so it sums to the People stat above), otherwise the
  // pack's pass over this list's ring and saved filters (a superset, disclosed
  // by the two lines directly above this section). Party and age are the only
  // dims both sources hold — see audienceMix.ts for why the pack's other
  // fourteen don't earn a place.
  const routeMix = route ? routeAudienceMix(targets) : null
  const partyMix = routeMix?.partyMix ?? listStats?.partyMix ?? []
  const ageMix = routeMix?.ageMix ?? listStats?.ageMix ?? []
  // Same three states as the stats: a pack still decoding has no mix, and
  // neither has one that settled with nothing — and 'no bars' must not be the
  // rendering of either.
  const audienceUnavailable = route
    ? false
    : routeFailed || preRouteFailed || (!liveTurf.locked && !listStats)
  const audiencePending = routePending || preRoutePending

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
            {/* The lock's consequence, said out loud on the surface carrying
                the control it disables. Delete used to render nothing at all
                here, which is indistinguishable from the feature not existing
                — and that is precisely how it was reported. The disabled
                control cannot show a title tooltip (it has
                `pointer-events-none`), so the explanation has to be text. */}
            {liveTurf.locked && (
              <p className="mt-1 text-xs text-muted-foreground">
                {LOCKED_TURF_MESSAGE}
              </p>
            )}
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
          {/* Rendered locked or not — disabled rather than absent. gp-api still
              refuses the call, so this changes nothing about what is possible;
              it changes whether a candidate can tell that Delete exists. */}
          {/* liveTurf, like Edit beside it: this control names the list in its
              label and in the confirm dialog's title, and the sheet can rename
              it, so the prop snapshot would ask "Delete Elm St?" about a list
              renamed to Riverside a moment earlier. Identity is unaffected —
              liveTurf is found BY turf.id, so the id the mutation sends is the
              same object either way. */}
          <DeleteTurfControl
            turf={liveTurf}
            locked={liveTurf.locked}
            onDeleted={onDeleted}
          />
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
              <Stat
                icon={DoorOpenIcon}
                label="Doors"
                {...packBackedStat(approximate(doors))}
              />
              {/* Gated on the route existing, not on the count being
                  non-zero: ADR 0007 drops do-not-knock residents, so a route
                  whose every resident is flagged has 0 knockable people, and
                  falling back on emptiness would answer that with the pack's
                  pre-route number instead of the frozen route's real 0. */}
              <Stat
                icon={UsersIcon}
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
                icon={ClockIcon}
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
                icon={MapPinIcon}
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
                icon={CalendarIcon}
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
                icon={CheckCircleIcon}
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
          {/* Directly under Overview, and deliberately not at the foot of the
              sheet where the prototype puts it: these are pack-derived numbers
              on an unknocked list, and the two disclosure lines that qualify
              them are the last thing above. Moving this below "Applied filters"
              would separate the caveat from the figures it is about. */}
          <section className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-info">
              Audience
            </h3>
            {audiencePending ? (
              <p className="py-0.5">
                <span className="block h-4 w-40 animate-pulse rounded bg-muted" />
                <span className="sr-only">Loading</span>
              </p>
            ) : audienceUnavailable ? (
              // Deliberately not a second account of WHY: Overview already
              // prints the one explanation, and a sheet that gives the same
              // failure two wordings teaches a candidate to read them as two
              // different failures.
              <p className="text-sm text-muted-foreground">
                No breakdown to show — the numbers above are unavailable.
              </p>
            ) : partyMix.length === 0 && ageMix.length === 0 ? (
              // A frozen route reaching here is not an empty list — it is a
              // list whose every resident is flagged, since the mix is built
              // from `knockableTargets` and ADR 0007 / 0008 drop those. Saying
              // "yet" to someone holding a walked list reads as the sheet
              // having lost their route, and "no one" contradicts the roster
              // below it, which still lists every one of them.
              <p className="text-sm text-muted-foreground">
                {route
                  ? 'Everyone in this list is marked do-not-knock or “not a voter”, so there is no audience left to break down.'
                  : 'No one to describe in this list yet.'}
              </p>
            ) : (
              <>
                <Breakdown title="Party" slices={partyMix} />
                {/* The pack ships raw bucket keys ('35_50'), and the route's
                    raw ages are bucketed onto the same ones, so one formatter
                    serves both branches. */}
                <Breakdown
                  title="Age"
                  slices={ageMix}
                  format={ageBucketLabel}
                />
              </>
            )}
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-info">
              Applied filters
            </h3>
            {appliedFilterGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No filters applied — this list targets all contacts.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {appliedFilterGroups.map((group) => (
                  <div key={group.field} className="flex flex-col gap-1.5">
                    <p className="text-xs font-medium text-muted-foreground">
                      {group.field}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {/* Labels repeat across fields — 'Unknown' is an option on
                          11 of them — so the label alone isn't a stable key,
                          even inside one group (income ranges and language
                          codes land here from two different sources). */}
                      {group.labels.map((label, index) => (
                        <span
                          key={`${label}-${index}`}
                          className="rounded-full border border-border px-2.5 py-1 text-xs"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-info">
              Doors in this list
            </h3>
            {!liveTurf.locked ? (
              // The honest answer, and the one the prototype's fixture data let
              // it skip. The voter pack is positions plus u8 category planes —
              // it can say how many people are in this ring and what they are,
              // which is what everything above is built from, but it holds no
              // name, no address line and no person id. The only roster that
              // exists anywhere is the frozen route's, and building one is the
              // billed Geoapify call `Knock` makes.
              //
              // First sentence is the draw step's, word for word: the same
              // candidate meets this limitation while drawing a ring and again
              // here on the list they saved from it, and one limitation worded
              // two ways is how they learn to trust neither surface.
              //
              // Says nothing about whether the counts above succeeded, because
              // it is true either way — a fact about the data model, not a
              // report on a fetch. That is also what keeps it from ever
              // becoming the "here is everyone in the polygon" fallback.
              <p className="text-sm text-muted-foreground">
                Street addresses arrive with the route, once you knock this
                list. The map data these counts come from records where people
                are and what they are, not who they are — so there is nobody to
                name here yet.
              </p>
            ) : routePending ? (
              <p className="py-0.5">
                <span className="block h-4 w-40 animate-pulse rounded bg-muted" />
                <span className="sr-only">Loading</span>
              </p>
            ) : routeFailed || !route ? (
              <p className="text-sm text-muted-foreground">
                No doors to list — this list&rsquo;s route is unavailable.
              </p>
            ) : (
              <TurfRoster stops={route.stops} />
            )}
          </section>
        </div>
      </div>
      <EditTurfDialog
        turf={liveTurf}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </div>
  )
}
