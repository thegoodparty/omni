import { useState } from 'react'
import {
  CIVIC_PANEL_SHORT_GROUPS_SHOWN,
  UNDERREPRESENTED_GROUP_NAMES,
  type CivicPanelComposition,
} from '@goodparty_org/contracts'
import { Button } from '@styleguide'
import { DoorOpenIcon, PhoneIcon } from '@styleguide/components/ui/icons'
import {
  capitalizeFirst,
  SERVE_CITIZENS_PANEL_COPY as COPY,
} from '../citizensPanelCopy'
import { shortGroups, type ShortGroup } from './panelCharts'
import { reachGroupOf, useReachList } from './useReachList'

const SHOWN = CIVIC_PANEL_SHORT_GROUPS_SHOWN

const Card = ({
  title,
  line,
  children,
  testId,
}: {
  title: string
  line: string
  children?: React.ReactNode
  testId: string
}) => (
  <section
    className="flex flex-col gap-4 rounded-xl border border-border bg-background p-5"
    data-testid={testId}
  >
    <div className="flex flex-col gap-1">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="text-base text-muted-foreground">{line}</p>
    </div>
    {children}
  </section>
)

// Before anyone joins: when the first invites go out, and what this page
// shows once residents reply.
export const CivicPanelFirstJoin = ({
  firstInvites,
  place,
}: {
  firstInvites: string | null
  place: string | null
}) => (
  <Card
    title={COPY.firstJoinTitle}
    line={COPY.firstJoinLine(firstInvites, place ?? COPY.yourDistrict)}
    testId="civic-panel-first-join"
  />
)

type PlaceKind = CivicPanelComposition['placeKind']

// A tract by its human name, never its number; a precinct as filed.
const rowName = (row: ShortGroup, kind: PlaceKind, place: string): string => {
  if (row.kind === 'group') {
    return capitalizeFirst(UNDERREPRESENTED_GROUP_NAMES[row.group])
  }
  if (row.place.label) return capitalizeFirst(row.place.label)
  return kind === 'precinct'
    ? COPY.seatPlaces.precinct.name(row.place.name)
    : COPY.unnamedTract(place)
}

type Reach = ReturnType<typeof useReachList>

// 44px targets on a phone, under the group; inline at the row's end from lg.
const REACH_BUTTON = 'min-h-11 flex-1 lg:min-h-0 lg:flex-none'

const Row = ({
  row,
  kind,
  place,
  reach,
}: {
  row: ShortGroup
  kind: PlaceKind
  place: string
  // Once every resident a text can reach has an invite, each row opens a
  // door or call list of its own.
  reach: Reach | null
}) => {
  const name = rowName(row, kind, place)
  const group = reach ? reachGroupOf(row, kind) : null
  const seats = (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span
          className="min-w-0 truncate text-base text-foreground"
          title={name}
        >
          {name}
        </span>
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
          {COPY.groupSeats(row.have, row.need)}
        </span>
      </div>
      <span
        aria-hidden
        className="h-1 w-full overflow-hidden rounded-full bg-muted"
      >
        <span
          className="block h-full rounded-full bg-primary"
          style={{ width: `${Math.round((row.have / row.need) * 100)}%` }}
        />
      </span>
    </div>
  )
  if (!reach || !group) return <li>{seats}</li>
  const busy = reach.pending !== null
  return (
    <li className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-6">
      {seats}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="medium"
          className={REACH_BUTTON}
          disabled={busy}
          onClick={() =>
            void reach.reach(group, 'door', COPY.reachListName.door(name))
          }
        >
          <DoorOpenIcon className="size-4" aria-hidden />
          {COPY.knockDoors}
          <span className="sr-only">{`, ${name}`}</span>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="medium"
          className={REACH_BUTTON}
          disabled={busy}
          onClick={() =>
            void reach.reach(group, 'phone', COPY.reachListName.phone(name))
          }
        >
          <PhoneIcon className="size-4" aria-hidden />
          {COPY.call}
          <span className="sr-only">{`, ${name}`}</span>
        </Button>
      </div>
    </li>
  )
}

type NextProps = {
  composition: CivicPanelComposition
  members: number
  goal: number
  exhausted: boolean
  place: string | null
}

const NextCard = ({
  composition,
  members,
  goal,
  exhausted,
  place,
  reach,
}: NextProps & { reach: Reach | null }) => {
  const [expanded, setExpanded] = useState(false)
  const rows = shortGroups({ composition, members, goal })
  if (rows.length === 0) return null
  const where = place ?? COPY.yourDistrict
  const shown = expanded ? rows : rows.slice(0, SHOWN)
  return (
    <Card
      title={exhausted ? COPY.nextTitleExhausted : COPY.nextTitle}
      line={exhausted ? COPY.nextLineExhausted() : COPY.nextLine(where)}
      testId="civic-panel-next"
    >
      <ul className="flex flex-col gap-4">
        {shown.map((row) => (
          <Row
            key={`${row.kind}-${row.key}`}
            row={row}
            kind={composition.placeKind}
            place={where}
            reach={reach}
          />
        ))}
      </ul>
      {!expanded && rows.length > SHOWN ? (
        <Button
          type="button"
          variant="outline"
          size="medium"
          className="self-start"
          onClick={() => setExpanded(true)}
        >
          {COPY.seeEveryGroup}
        </Button>
      ) : null}
      {reach?.flow}
    </Card>
  )
}

const ReachableNext = (props: NextProps) => {
  const reach = useReachList()
  return <NextCard {...props} reach={reach} />
}

// The groups furthest below their share of the district, across age,
// gender, race and place: the page's one answer to who's next. While
// GoodParty sends the invites it never asks the official to invite anyone;
// once every resident a text can reach has one, each group can be knocked
// or called.
export const CivicPanelNext = (props: NextProps) =>
  props.exhausted ? (
    <ReachableNext {...props} />
  ) : (
    <NextCard {...props} reach={null} />
  )
