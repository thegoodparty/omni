'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  DOOR_KNOCK_STATUSES,
  DoorKnockingTurf,
  DoorKnockStatus,
} from '@goodparty_org/contracts'
import {
  ActivityIcon,
  Button,
  CarIcon,
  ClockIcon,
  DownloadIcon,
  FileTextIcon,
  FootprintsIcon,
  HouseIcon,
  IconButton,
  PencilIcon,
  RadioIcon,
  UsersIcon,
} from '@styleguide'
import {
  DetailsSection,
  FilterGroup,
  Metric,
  MetricGrid,
} from 'app/dashboard/outreach/v2/listDetails/ListDetailsMetric'
import {
  ChannelBadge,
  HistoryStatusText,
} from 'app/dashboard/outreach/v2/channelMeta'
import { ListDetailsFooter } from 'app/dashboard/outreach/v2/listDetails/ListDetailsFooter'
import { ListDetailsSheetShell } from 'app/dashboard/outreach/v2/listDetails/ListDetailsSheetShell'
import { useSnackbar } from 'helpers/useSnackbar'
import EditTurfDialog from './EditTurfDialog'
import filterSections, {
  legacyAgeOptions,
} from 'app/dashboard/contacts/[[...attr]]/components/configs/filters.config'
import { LANGUAGE_KEY_TO_CODE } from 'app/dashboard/contacts/crm/shared/voterFileFilterTransform.util'
import {
  routeQueryOptions,
  savedListsQueryOptions,
  turfColorLabel,
} from './turfQueries'
import { useDoorKnockingServeMode, useTurfsQuery } from './doorKnockingSurface'
import { WIN_ONLY_FILTER_FIELD_KEYS } from './savedListFilters'
import { estimateOutingSeconds } from './walkEstimate'
import { formatDuration } from './formatDuration'
import { turfStatusLabel } from './turfLifecycle'
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
// candidate reads their list back in the shape they picked it. It is also why
// the design's single flat "Filters" row is rendered as one row per field
// here — same pills, same section, with the one thing added that makes them
// readable.
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

// The field LABELS an elected official never sees a row for, from the same
// keys the create flow hides the groups behind. Labels rather than option keys
// because the read-back is already grouped by field here, and a group whose
// every pill was dropped would still print its heading over nothing.
//
// A list cut on the Win surface can still carry party columns — nothing
// backfills a saved filter — so this is a read-back gate and not merely the
// mirror of a control that is no longer offered.
const WIN_ONLY_FIELD_LABELS = new Set(
  filterSections
    .flatMap((section) => section.fields)
    .filter((field) => WIN_ONLY_FILTER_FIELD_KEYS.includes(field.key))
    .map((field) => field.label),
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

// How the walk went, one row per canvass status: the design's bordered table,
// with a caption naming the denominator and a hairline between every row.
//
// A table rather than the bar chart this section used to be, because the rows
// are a fixed vocabulary — a status nobody recorded still renders, at zero,
// and a column of empty bars is a worse picture of that than a column of
// zeroes. The dot keeps the colour, which is the part that ties a row to the
// map, the walk's strip and the paper sheet: one outcome is one colour
// everywhere in the feature.
//
// Counts come from `knockStatusCounts`, shared with `WalkView` — the walk and
// this drawer report one frozen route, and a second local bucketing is how
// they would come to disagree.
const StatusBreakdownTable = ({
  counts,
  total,
  caption,
}: {
  counts: Record<DoorKnockStatus, number>
  total: number
  caption: string
}) => (
  <div className="overflow-hidden rounded-xl border border-border bg-card">
    <div className="flex items-center gap-2 px-3 py-2 text-muted-foreground">
      <ActivityIcon size={16} aria-hidden="true" className="shrink-0" />
      <p className="text-xs">{caption}</p>
    </div>
    <dl className="m-0">
      {DOOR_KNOCK_STATUSES.map((status) => {
        const people = counts[status]
        const percent = total > 0 ? Math.round((people / total) * 100) : 0
        return (
          <div key={status} className="border-t border-border">
            <div className="flex items-center justify-between gap-3 px-3 py-2">
              <dt className="flex min-w-0 items-center gap-2 text-sm">
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: STATUS_DOT_COLORS[status] }}
                />
                <span className="truncate">{STATUS_LABELS[status]}</span>
              </dt>
              <dd className="flex shrink-0 items-baseline gap-2 text-sm font-medium">
                <span className="w-[5ch] text-right tabular-nums">
                  {people.toLocaleString()}
                </span>
                <span className="w-[4ch] text-right text-xs font-normal text-muted-foreground tabular-nums">
                  {percent}%
                </span>
              </dd>
            </div>
          </div>
        )
      })}
    </dl>
  </div>
)

// SEAM — the details drawer (Wave 1B).
//
// This surface owns everything the drawer says about ONE list, and as of 3.0
// that is exactly the frozen route plus the saved filters behind it. It used
// to sit behind a `TurfDetailsDrawer` wrapper whose whole job was deriving
// pre-route counts from the voter pack — the doors and people inside a
// polygon that had been drawn but not yet bought. A list cannot be in that
// state any more, so the wrapper had nothing left to compute and the
// orchestrator renders this directly.
//
// The orchestrator owns: which turf is open, and its own references to a turf
// this drawer can delete. Keep the prop surface this narrow — a drawer that
// reaches for door-knocking orchestrator state cannot be mounted from the
// outreach history table, which is where the canvas puts it.
interface TurfDetailsSheetProps {
  turf: DoorKnockingTurf
  onClose: () => void
  // Open the walk. The drawer reports the gesture and the orchestrator decides
  // what happens, which is now the same thing on every list: the route was
  // bought at creation, so there is nothing left to confirm or pay for. The
  // same handler the rail card's Knock button calls, so one list cannot start
  // two different ways.
  onKnock: (turf: DoorKnockingTurf) => void
}

export default function TurfDetailsSheet({
  turf,
  onClose,
  onKnock,
}: TurfDetailsSheetProps) {
  const [editOpen, setEditOpen] = useState(false)
  const { successSnackbar } = useSnackbar()
  // `turf` is a snapshot the page captured when the row was clicked. Reading
  // the live row keeps the sheet honest after a refetch — the page already
  // runs this query, so React Query serves it from cache rather than fetching
  // twice. Rule of thumb: liveTurf for anything this surface can edit or that
  // a walk can move — name, colour, the two door counts — and the prop for
  // identity (id, filter id), which no edit can change.
  const serveMode = useDoorKnockingServeMode()
  const turfsQuery = useTurfsQuery()
  const liveTurf =
    turfsQuery.data?.find((candidate) => candidate.id === turf.id) ?? turf
  // Unconditional: every list is born with its frozen route, so there is no
  // pre-route state for this sheet to report and no reason to gate the fetch.
  // The whole pack-backed branch this sheet used to carry — approximate
  // counts, an estimated walk time, "Not knocked yet" — described a turf that
  // had been drawn but not bought, which is a thing that cannot exist now.
  const routeQuery = useQuery(routeQueryOptions(turf.id))
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
  const appliedFilterGroups = groupByField(appliedFilterEntries).filter(
    ({ field }) => !serveMode || !WIN_ONLY_FIELD_LABELS.has(field),
  )

  const route = routeQuery.data
  const targets = knockableTargets(route?.stops ?? [])
  // A route exists for every list, so until it arrives every route-derived
  // stat is loading or broken. There is no third answer: reporting a count off
  // something other than the frozen route would be a second account of a list
  // that only has one.
  const routePending = !route && !routeQuery.isError
  const routeFailed = routeQuery.isError
  // Doors are addresses, not the coordinates the router visits: a stop at a
  // twelve-flat building is twelve doors and one stop.
  const doors = route ? countDoors(route.stops) : 0
  // Spread into Metric so every route-derived cell agrees about which of the
  // three states it is in.
  const routeStat = (value: string) => ({
    pending: routePending,
    value: routeFailed ? 'Unavailable' : value,
  })

  const mode = route?.route.mode ?? null

  // The design's Progress section counts DOORS on both sides, and these are
  // the very figures `knockedDoorCount` was added to gp-api for: the same two
  // numbers the rail card's overline prints, from the same aggregate, so a
  // candidate who reads the card and then opens Details cannot meet two
  // accounts of one list's progress.
  const knockedDoors = liveTurf.knockedDoorCount
  const totalDoors = liveTurf.doorCount
  const knockedPercent =
    totalDoors > 0 ? Math.round((knockedDoors / totalDoors) * 100) : 0

  // What the walk actually produced, per status, off the frozen route only.
  const statusCounts = route ? knockStatusCounts(route.stops) : null
  // ADR 0008's follow-up is optional, so `not_a_voter` is a status a resident
  // can carry with no reason recorded — and it is the reason, not the status,
  // that drops them from `knockableTargets`. So this bucket is the doors logged
  // "not a voter" whose "what happened?" is still unanswered, which is worth a
  // line only when there are any: it is the one row whose count moves when
  // somebody answers a question rather than when somebody knocks a door.
  const unresolvedNotAVoter = statusCounts?.not_a_voter ?? 0

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
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2 className="truncate text-[22px] font-semibold text-foreground">
                  {liveTurf.name}
                </h2>
                <HistoryStatusText label={turfStatusLabel(liveTurf)} />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <ChannelBadge type="nativeDoorKnocking" />
                <span className="text-sm text-muted-foreground">
                  Overview of this list, its route, and progress.
                </span>
              </div>
            </div>
            {/* The one control the design's footer has no room for, and the
                only way to rename a list or change the colour its ring is
                drawn in — the create flow no longer asks for either. Kept as
                an icon in the header rather than a fourth footer button, which
                is where it would start competing with Start knocking.
                Unconditional now: the update endpoint takes name and colour
                and nothing else, so there is no frozen geometry for it to put
                at risk and no stage at which a list stops being renameable. */}
            <IconButton
              variant="ghost"
              size="small"
              className="shrink-0 text-muted-foreground"
              aria-label={`Edit ${liveTurf.name}`}
              onClick={() => setEditOpen(true)}
            >
              <PencilIcon size={16} />
            </IconButton>
          </div>
        }
        footer={
          <ListDetailsFooter
            mode="continue"
            leading={
              // The compact `PDF`, which the design keeps here even though the
              // walk and the outreach drawer both got the full-width `Export
              // this list to PDF`: in a footer beside Start knocking the word
              // is the whole affordance and the sentence would not fit. Every
              // list has a route, so it is never a link to a 404. The file is
              // built by a route handler, so a plain link costs this bundle
              // nothing.
              <Button asChild variant="outline">
                <a
                  href={`/dashboard/door-knocking/print/${turf.id}/pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => successSnackbar('Walk sheet downloaded')}
                >
                  <DownloadIcon size={16} />
                  PDF
                </a>
              </Button>
            }
            primary={{
              kind: 'button',
              // "Continue" once anything has been logged, which is what the
              // design branches on too: a route bought and never walked is
              // still a walk that has not started, and every list now has one
              // from the moment it exists.
              label: knockedDoors > 0 ? 'Continue knocking' : 'Start knocking',
              icon: <FootprintsIcon size={16} />,
              onClick: () => {
                onClose()
                onKnock(liveTurf)
              },
            }}
          />
        }
      >
        <DetailsSection title="Applied filters">
          <FilterGroup title="Audience" values={[filter?.name ?? turf.name]} />
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
        <DetailsSection title="Overview">
          <MetricGrid>
            <Metric
              icon={<FileTextIcon />}
              label="Name"
              value={liveTurf.name}
            />
            <Metric
              icon={<RadioIcon />}
              label="Channel"
              value="Door knocking"
            />
            {/* Doors are addresses, which is what the design calls
                households: one stop at a twelve-flat building is twelve of
                these and one of the router's coordinates. */}
            <Metric
              icon={<HouseIcon />}
              label="Households"
              {...routeStat(doors.toLocaleString())}
            />
            {/* Exact, with nothing to hedge: these came through the create
                transaction's own evaluation of the polygon, which is also what
                applied ADR 0007 and dropped the do-not-knock residents. A
                route whose every resident is flagged reports a real 0. */}
            <Metric
              icon={<UsersIcon />}
              label="People"
              {...routeStat(targets.length.toLocaleString())}
            />
            {/* The whole evening, under the design's one unqualified label.
                Geoapify's `totalSeconds` is the agent plan's TRAVEL time — the
                jobs we send carry no per-stop duration — so printing it raw
                undersold an evening by more than half, and the hint that used
                to say so was a second label the design does not draw. Adding
                the app's own knocking pace to it answers the question the
                label asks instead, and off the same helper the walk view's
                header uses, so a list cannot quote two different evenings. */}
            <Metric
              icon={<ClockIcon />}
              label="Estimated time"
              {...routeStat(
                route
                  ? formatDuration(
                      estimateOutingSeconds(route.route.totalSeconds, doors),
                    )
                  : '',
              )}
            />
            <Metric
              icon={mode === 'drive' ? <CarIcon /> : <FootprintsIcon />}
              label="Route type"
              {...routeStat(mode === 'drive' ? 'Drive route' : 'Walk route')}
            />
            <Metric
              icon={
                <span
                  className="mt-0.5 block size-4 rounded-full"
                  style={{ backgroundColor: liveTurf.color }}
                />
              }
              label="List color"
              value={turfColorLabel(liveTurf.color)}
            />
          </MetricGrid>
          {routeFailed && (
            <p className="text-sm text-destructive">
              This list&rsquo;s route could not be loaded, so the numbers above
              are unavailable. Refresh to try again — nothing about the route or
              the knocks logged against it has changed.
            </p>
          )}
          {/* No "About" disclosure here, and no unshadeable-filter line
              either. Both belonged to the pack-derived pre-route counts: the
              map can't shade every filter, so a preview of a shape is a
              superset of who gets knocked. These numbers are the frozen
              route's, produced by the same evaluation that decided which doors
              are in it — the create flow still discloses the gap at the one
              moment it exists, which is while the shape is still being
              drawn. */}
        </DetailsSection>
        <DetailsSection title="Progress">
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
            {/* No "Not knocked yet" branch: a list with no route is what that
                described, and every list has one. Zero knocked doors of forty
                is a real answer and reads as one. */}
            <p className="text-sm font-medium">
              {`${knockedDoors.toLocaleString()} of ${totalDoors.toLocaleString()} · ${knockedPercent}%`}
            </p>
            {/* Decorative: the line above already reads "12 of 40 · 30%", so
                the bar is a picture of that sentence and not a second claim. */}
            <span
              aria-hidden="true"
              className="block h-1.5 w-full overflow-hidden rounded-full bg-muted"
            >
              <span
                className="block h-full rounded-full bg-primary"
                style={{ width: `${knockedPercent}%` }}
              />
            </span>
          </div>
        </DetailsSection>
        <DetailsSection title="Status breakdown">
          {/* `statusCounts` is null exactly when the route is, so the first two
              arms cover every state in which it can be missing. The third is
              kept as an exhaustive arm rather than a non-null assertion — the
              two booleans narrow nothing for the compiler. */}
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
          ) : !statusCounts ? null : targets.length === 0 ? (
            // The table is built over knockable people, so a route with none
            // is a fully flagged list rather than an empty one.
            <p className="text-sm text-muted-foreground">
              Everyone in this list is marked do-not-knock or &ldquo;not a
              voter&rdquo;, so there are no outcomes to report.
            </p>
          ) : (
            <>
              <StatusBreakdownTable
                counts={statusCounts}
                total={targets.length}
                caption={`Based on ${targets.length.toLocaleString()} door knocking contact${
                  targets.length === 1 ? '' : 's'
                }`}
              />
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
      </ListDetailsSheetShell>
      <EditTurfDialog
        turf={liveTurf}
        open={editOpen}
        onOpenChange={setEditOpen}
      />
    </>
  )
}
