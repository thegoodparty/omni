'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  DOOR_KNOCK_STATUSES,
  DoorKnockingMode,
  DoorKnockingTurf,
  DoorKnockStatus,
} from '@goodparty_org/contracts'
import {
  ArchiveIcon,
  Button,
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  DoorOpenIcon,
  MapPinIcon,
  PencilIcon,
  RefreshIcon,
  ToggleGroup,
  ToggleGroupItem,
  UsersIcon,
} from '@styleguide'
import {
  DetailsSection,
  FilterGroup,
  Metric,
  MetricGrid,
} from 'app/dashboard/outreach/v2/listDetails/ListDetailsMetric'
import { HistoryStatusText } from 'app/dashboard/outreach/v2/channelMeta'
import { ListDetailsFooter } from 'app/dashboard/outreach/v2/listDetails/ListDetailsFooter'
import { ListDetailsSheetShell } from 'app/dashboard/outreach/v2/listDetails/ListDetailsSheetShell'
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
import {
  unpreviewableDisclosureLabels,
  unpreviewableDisclosureSentence,
} from './createFlow/voterFilterPreview'
import type { DimSlice, PolygonStats } from './filterEngine'
import { ageBucketLabel, routeAudienceMix } from './audienceMix'
import DeleteTurfControl, { LOCKED_TURF_MESSAGE } from './DeleteTurfControl'
import {
  canArchiveTurf,
  turfStage,
  turfStatusLabel,
  useTurfLifecycle,
} from './turfLifecycle'
import {
  knockStatusCounts,
  STATUS_DOT_COLORS,
  STATUS_LABELS,
} from './statusPresentation'
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

// How the walk went, one row per canvass status. A SIBLING of `Breakdown`
// rather than a colour prop on it, because the two differ in more than paint:
//
//   - its rows are a fixed vocabulary (`DOOR_KNOCK_STATUSES`), so a status
//     nobody recorded renders at zero. `Breakdown` returns null on a zero total
//     and floors every bar to a visible sliver precisely BECAUSE its sources
//     drop empty buckets, so it can never be handed one. Teaching it to
//     sometimes floor and sometimes not is two behaviours in one component,
//     decided by a caller.
//   - the colour is the legend's, carried by a dot as well as the bar — the
//     same `STATUS_DOT_COLORS` the map dots, the walk's strip and the landing
//     chips use, so one outcome is one colour everywhere in the feature. A
//     party or age bucket has no colour of its own to be wrong about.
//   - its denominator is a figure stated elsewhere on this sheet (the People
//     stat), not the slices' own sum, so the rows sum to a number the candidate
//     can already see rather than to themselves.
//
// Counts come from `knockStatusCounts`, shared with `WalkView` — the walk and
// this drawer report one frozen route, and a second local bucketing is how they
// would come to disagree.
const StatusBreakdown = ({
  counts,
  total,
}: {
  counts: Record<DoorKnockStatus, number>
  total: number
}) => (
  <ul className="flex flex-col gap-1.5">
    {DOOR_KNOCK_STATUSES.map((status) => {
      const people = counts[status]
      const percent = total > 0 ? Math.round((people / total) * 100) : 0
      // Zero is a real answer here, unlike in `Breakdown` — "nobody refused"
      // is worth printing as `0 · 0%` with an empty bar. What still has to be
      // floored is a NON-empty bucket that rounds away: one refusal in 400
      // doors is not "0%", and a bar of no width beside a count of 1 reads as
      // a rendering fault rather than as a small number.
      const percentLabel = people > 0 && percent === 0 ? '<1' : String(percent)
      const barWidth = people > 0 ? Math.max(percent, 1) : 0
      return (
        <li key={status} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: STATUS_DOT_COLORS[status] }}
              />
              <span className="truncate">{STATUS_LABELS[status]}</span>
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {`${people.toLocaleString()} · ${percentLabel}%`}
            </span>
          </div>
          {/* Decorative, like every other bar on this sheet: the row above
              already reads "12 · 30%", so the bar is a picture of that
              sentence and not a second claim. */}
          <span
            aria-hidden="true"
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          >
            <span
              className="block h-full rounded-full"
              style={{
                width: `${barWidth}%`,
                backgroundColor: STATUS_DOT_COLORS[status],
              }}
            />
          </span>
        </li>
      )
    })}
  </ul>
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
  // One expression feeding both the printed percent and the bar's width, so
  // the number and the picture of it cannot round differently.
  const loggedPercent =
    targets.length > 0 ? Math.round((logged / targets.length) * 100) : 0
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
  // Metric so they agree about which one they're in.
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
  const unpreviewableDisclosure = unpreviewableDisclosureSentence(
    unpreviewableDisclosureLabels(unpreviewableKeys),
  )
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

  // What the walk actually produced, per status. Off the frozen route only —
  // the landing rail's seven chips are the pack's superset over this list's
  // polygon (which is why they say "About") and can be describing a different
  // list entirely, since Details opens on any row rather than on the selected
  // scope. Two quantities that legitimately differ, so this is not that rail
  // reported twice; see UI-DRIFT-REVIEW.md § 6.
  const statusCounts = route ? knockStatusCounts(route.stops) : null
  // ADR 0008's follow-up is optional, so `not_a_voter` is a status a resident
  // can carry with no reason recorded — and it is the reason, not the status,
  // that drops them from `knockableTargets`. So this bucket is the doors logged
  // "not a voter" whose "what happened?" is still unanswered, which is worth a
  // line only when there are any: it is the one row whose count moves when
  // somebody answers a question rather than when somebody knocks a door.
  const unresolvedNotAVoter = statusCounts?.not_a_voter ?? 0

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

  // The rail's own lifecycle hook, not a second one of this drawer's. Archive
  // writes two rows — the turf and the outreach envelope reporting it — and
  // the whole point of closing that seam is that exactly one place writes
  // them; a drawer with its own mutation would be the second writer that lets
  // them drift apart again. It carries its own snackbars, so this surface and
  // the card say the same thing about the same act.
  const stage = turfStage(liveTurf)
  const lifecycle = useTurfLifecycle(liveTurf)

  return (
    <>
      <ListDetailsSheetShell
        open
        onOpenChange={(next) => {
          if (!next) onClose()
        }}
        title={liveTurf.name}
        header={
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span
              aria-hidden="true"
              className="mt-2.5 h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: liveTurf.color }}
            />
            <div className="min-w-0 flex-1">
              {/* The canvas draws a status indicator beside the name in BOTH
                  details drawers, and the outreach one has always rendered it
                  (`HistoryStatusText`) while this one rendered nothing — so a
                  candidate could open Details on a finished list and find the
                  footer's Move to archive the only thing on the surface that
                  knew. Same component, so the two drawers cannot describe one
                  list in two vocabularies. liveTurf, like everything else that
                  moves: a list completed while the drawer is open. */}
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="truncate text-[22px] font-semibold text-foreground">
                  {liveTurf.name}
                </h2>
                <HistoryStatusText label={turfStatusLabel(liveTurf)} />
              </div>
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
                the link would 404 on an unknocked one — and the file is built
                by a route handler, so a plain link costs this bundle nothing. */}
            {liveTurf.locked && (
              <a
                href={`/dashboard/door-knocking/print/${turf.id}/pdf`}
                className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-medium underline-offset-2 hover:bg-muted/50 hover:underline"
              >
                PDF
              </a>
            )}
          </div>
        }
        footer={
          // The canvas's modes, read off the same lifecycle the rail sections
          // on. An unknocked list is `edit` — the one object in this product
          // with both a PUT and a DELETE genuinely behind it, which is why
          // that mode lands here rather than on a paid campaign nobody can
          // edit. A knocked list still being walked is `continue`, and carries
          // no CTA: the walk is entered from the rail's Knock control, which
          // the orchestrator owns behind a frozen prop interface, so "Continue
          // knocking" lives in the outreach history drawer where it is a plain
          // link. Done or archived is `done`, whose canvas primary is "Show
          // results" — on this surface that is the drawer already being read,
          // so the slot carries the shelf action instead.
          <ListDetailsFooter
            mode={
              !liveTurf.locked
                ? 'edit'
                : stage === 'active'
                  ? 'continue'
                  : 'done'
            }
            destructive={
              // Rendered locked or not — disabled rather than absent. gp-api
              // still refuses the call, so this changes nothing about what is
              // possible; it changes whether a candidate can tell that Delete
              // exists.
              //
              // liveTurf, like Edit beside it: this control names the list in
              // its label and in the confirm dialog's title, and the sheet can
              // rename it, so the prop snapshot would ask "Delete Elm St?"
              // about a list renamed to Riverside a moment earlier. Identity is
              // unaffected — liveTurf is found BY turf.id, so the id the
              // mutation sends is the same object either way.
              <DeleteTurfControl
                turf={liveTurf}
                locked={liveTurf.locked}
                onDeleted={onDeleted}
              />
            }
            primary={
              liveTurf.locked
                ? null
                : {
                    kind: 'button',
                    label: 'Edit list',
                    icon: <PencilIcon size={16} />,
                    // Same lock rule as Delete, for the same reason: gp-api's
                    // update asserts not-locked because the endpoint also
                    // accepts geoPoly, and the polygon is what the frozen route
                    // was computed from.
                    onClick: () => setEditOpen(true),
                  }
            }
            secondary={
              // The same gate the rail card uses, so one list cannot offer the
              // shelf from its card and refuse it from its drawer: gp-api
              // applies the transition to a knocked list only, and archiving a
              // walk still in progress would shelve it mid-stride.
              stage === 'archived' ? (
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={lifecycle.pendingAction === 'restore'}
                  onClick={lifecycle.restore}
                >
                  <RefreshIcon className="size-4" />
                  Restore
                </Button>
              ) : (
                canArchiveTurf(liveTurf) &&
                stage === 'done' && (
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={lifecycle.pendingAction === 'archive'}
                    onClick={lifecycle.moveToArchive}
                  >
                    <ArchiveIcon className="size-4" />
                    Move to archive
                  </Button>
                )
              )
            }
          />
        }
      >
        <DetailsSection title="Overview">
          <MetricGrid>
            {/* Both branches describe this list's audience now that the
                pre-route one is computed with the turf's saved filters, so
                the labels no longer have to hedge about which population
                they mean — which is the whole point, sitting as they do
                directly above the "Applied filters" pills. A locked turf's
                authoritative counts are the frozen route's, so these wait
                for it rather than showing the pack's answer and then
                swapping it out mid-load. */}
            <Metric
              icon={<DoorOpenIcon />}
              label="Doors"
              {...packBackedStat(approximate(doors))}
            />
            {/* Gated on the route existing, not on the count being
                non-zero: ADR 0007 drops do-not-knock residents, so a route
                whose every resident is flagged has 0 knockable people, and
                falling back on emptiness would answer that with the pack's
                pre-route number instead of the frozen route's real 0. */}
            <Metric
              icon={<UsersIcon />}
              label="People"
              {...packBackedStat(
                approximate(route ? targets.length : (listStats?.people ?? 0)),
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
            <Metric
              icon={<ClockIcon />}
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
            <Metric
              icon={<MapPinIcon />}
              label="Route type"
              {...routeStat(
                route
                  ? `${route.route.mode === 'walk' ? 'Walk' : 'Drive'} route${
                      route.route.loop ? ' · loop' : ''
                    }`
                  : 'Not knocked yet',
              )}
            />
            <Metric
              icon={<CalendarIcon />}
              label="Created"
              value={new Date(turf.createdAt).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            />
            {/* Logged, not reached: not-home, inaccessible and refused all
                count here, and none of them is a conversation. */}
            {/* The bar is the route's or it is absent. An unlocked list
                reads "Not knocked yet", and a 0% bar beside those words
                would draw an empty walk as a walk barely started; a failed
                or in-flight fetch has no figure to draw at all. So it hangs
                off `route` — the same value `routeStat` branches on — rather
                than off `loggedPercent`, which is 0 in all four states. */}
            <Metric
              icon={<CheckCircleIcon />}
              label="People logged"
              {...routeStat(
                route
                  ? `${logged} of ${targets.length} · ${loggedPercent}%`
                  : 'Not knocked yet',
              )}
              progress={route && !routeFailed ? loggedPercent : undefined}
            />
          </MetricGrid>
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
              This list&rsquo;s route could not be loaded, so the numbers above
              are unavailable. Refresh to try again — nothing about the route or
              the knocks logged against it has changed.
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
              &ldquo;About,&rdquo; because the map can&rsquo;t show every filter
              this list applies, and knocking also skips anyone marked
              do-not-knock or &ldquo;not a voter&rdquo; — so you&rsquo;ll walk
              fewer doors than this.
            </p>
          )}
          {/* The draw step's own sentence, from the same helper, so the
              filter isn't named one way while drawing and another here. */}
          {discloseApproximation && unpreviewableDisclosure && (
            <p className="text-xs text-muted-foreground">
              {unpreviewableDisclosure}
            </p>
          )}
        </DetailsSection>
        {/* Directly under Overview, and deliberately not at the foot of the
            sheet where the prototype puts it: these are pack-derived numbers
            on an unknocked list, and the two disclosure lines that qualify
            them are the last thing above. Moving this below "Applied filters"
            would separate the caveat from the figures it is about. */}
        <DetailsSection title="Audience">
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
            // having lost their route.
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
              <Breakdown title="Age" slices={ageMix} format={ageBucketLabel} />
            </>
          )}
        </DetailsSection>
        {/* Below Audience rather than above it, and that ordering is the same
            argument Audience's own placement makes: the two disclosure lines at
            the foot of Overview qualify the pack's numbers, and Audience is the
            section they qualify, so nothing may come between them. This section
            needs no such adjacency — it is the frozen route's own outcomes,
            exact and unhedged, which is why it exists at all. */}
        <DetailsSection title="How the walk went">
          {routePending ? (
            <p className="py-0.5">
              <span className="block h-4 w-40 animate-pulse rounded bg-muted" />
              <span className="sr-only">Loading</span>
            </p>
          ) : routeFailed ? (
            // The word the stats above use, and no second account of why:
            // Overview already prints the one explanation, and a sheet that
            // gives a single failure two wordings teaches a candidate to read
            // them as two failures.
            <p className="text-sm text-muted-foreground">
              Unavailable — no outcomes to show.
            </p>
          ) : !statusCounts ? (
            // Reachable only on a genuinely unlocked list, exactly like the
            // stats above: lockedness IS the frozen route, so the two states
            // where a locked list has no route yet are the two branches above
            // and never this one.
            <p className="text-sm text-muted-foreground">
              Not knocked yet — outcomes arrive once someone walks this list.
            </p>
          ) : targets.length === 0 ? (
            // The same distinction the Audience section draws, for the same
            // reason: the table is built over knockable people, so a route with
            // none is a fully flagged list rather than an empty one.
            <p className="text-sm text-muted-foreground">
              Everyone in this list is marked do-not-knock or &ldquo;not a
              voter&rdquo;, so there are no outcomes to report.
            </p>
          ) : (
            <>
              {/* Naming the denominator once, in the vocabulary the stat above
                  already uses. "logged" and never "reached": three of these
                  seven outcomes are doors where nobody spoke to anybody. */}
              <p className="text-xs text-muted-foreground">
                {`All ${targets.length.toLocaleString()} people this list targets, by what was logged at their door.`}
              </p>
              <StatusBreakdown counts={statusCounts} total={targets.length} />
              {unresolvedNotAVoter > 0 && (
                <p className="text-xs text-muted-foreground">
                  &ldquo;Not a voter&rdquo; counts doors where that was logged
                  and nobody has said yet whether they moved or died. Answering
                  that takes the resident out of this list&rsquo;s people count
                  altogether, the same as marking a door do-not-knock.
                </p>
              )}
            </>
          )}
        </DetailsSection>
        <DetailsSection title="Applied filters">
          {appliedFilterGroups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No filters applied — this list targets all contacts.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {appliedFilterGroups.map((group) => (
                <FilterGroup
                  key={group.field}
                  title={group.field}
                  values={group.labels}
                />
              ))}
            </div>
          )}
        </DetailsSection>
      </ListDetailsSheetShell>
      <EditTurfDialog
        turf={liveTurf}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </>
  )
}
