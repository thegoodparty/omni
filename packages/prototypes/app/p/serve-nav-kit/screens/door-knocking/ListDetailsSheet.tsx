'use client'

import {
  Badge,
  Card,
  Drawer,
  DrawerContent,
  DrawerHandle,
  DrawerHeader,
  DrawerTitle,
  Progress,
} from '@goodparty_org/styleguide'
import {
  Calendar,
  Car,
  CheckCircle2,
  Clock,
  Footprints,
  Home,
  MapPin,
  Sparkles,
  Users,
} from 'lucide-react'
import { type ComponentType } from 'react'
import { SectionLabel } from '../../components/SectionLabel'
import {
  type CutFilters,
  type Ethnicity,
  type IncomeRange,
  type List,
  type Party,
  type Voter,
  CUSTOM_VOTER_LISTS,
  EDUCATION_LABEL,
  ISSUES,
  MARITAL_LABEL,
  PARTY_LABEL,
  formatDuration,
  getHouseholdCount,
  listMode,
  routeTotalMinutes,
} from './doorKnockingData'

// The details sheet uses the fuller filter-chip labels (source parity) — distinct
// from the VoterPanel demographic labels (shorter/spaced).
const DETAILS_INCOME_LABEL: Record<IncomeRange, string> = {
  '<50k': 'Under $50k',
  '50-100k': '$50k–$100k',
  '100-150k': '$100k–$150k',
  '150k+': '$150k+',
}
const DETAILS_ETHNICITY_LABEL: Record<Ethnicity, string> = {
  white: 'White',
  hispanic: 'Hispanic or Latino',
  black: 'Black or African American',
  asian: 'Asian',
  other: 'Other',
}

type Props = {
  open: boolean
  onOpenChange: (v: boolean) => void
  list: List | null
  kind: 'saved' | 'recommended'
  voters: Voter[]
}

const AGE_BUCKETS: {
  key: string
  label: string
  test: (a: number) => boolean
}[] = [
  { key: '18-34', label: '18–34', test: (a) => a >= 18 && a <= 34 },
  { key: '35-50', label: '35–50', test: (a) => a >= 35 && a <= 50 },
  { key: '51-64', label: '51–64', test: (a) => a >= 51 && a <= 64 },
  { key: '65+', label: '65+', test: (a) => a >= 65 },
]

// A rough turf label — the most common street in the list (source uses a real
// geocoded boundary; this is the synthetic stand-in).
const boundaryLabel = (voters: Voter[]): string | null => {
  if (voters.length === 0) return null
  const streets = new Map<string, number>()
  for (const v of voters) {
    const first = v.address.split(',')[0] ?? ''
    const street = first.replace(/^\d+\s+/, '').trim()
    if (street) streets.set(street, (streets.get(street) ?? 0) + 1)
  }
  const top = [...streets.entries()].sort((a, b) => b[1] - a[1])[0]
  return top ? `Around ${top[0]}` : null
}

const TRI_POS: Record<string, string> = {
  hasChildrenUnder18: 'Has kids under 18',
  veteran: 'Veteran',
  homeowner: 'Homeowner',
  businessOwner: 'Business owner',
}
const TRI_NEG: Record<string, string> = {
  hasChildrenUnder18: 'No kids under 18',
  veteran: 'Not a veteran',
  homeowner: 'Not a homeowner',
  businessOwner: 'Not a business owner',
}

const appliedFilterGroups = (
  f: CutFilters | null | undefined,
): { title: string; values: string[] }[] => {
  if (!f) return []
  const groups: { title: string; values: string[] }[] = []
  const push = (title: string, values: string[]) => {
    if (values.length) groups.push({ title, values })
  }
  push('Top issue', f.issue)
  push(
    'Party',
    (['D', 'R', 'I', 'U'] as Party[])
      .filter((k) => f.party[k])
      .map((k) => PARTY_LABEL[k]),
  )
  push(
    'Voter category',
    f.voterCategory.map((v) =>
      v === 'super_voter' ? 'Super voters' : 'Likely voters',
    ),
  )
  push('Age', f.ageRange)
  push(
    'Voter status',
    f.voterStatus.map((v) => (v === 'active' ? 'Active' : 'Inactive')),
  )
  push(
    'Registration',
    f.registered.map((v) => (v === 'yes' ? 'Registered' : 'Not registered')),
  )
  push(
    'Support',
    f.support.map((v) =>
      v === 'yes'
        ? 'Supporter'
        : v === 'no'
          ? 'Non-supporter'
          : 'Support unknown',
    ),
  )
  push(
    'Marital status',
    f.maritalStatus.map((v) => MARITAL_LABEL[v]),
  )
  push(
    'Education',
    f.education.map((v) => EDUCATION_LABEL[v]),
  )
  push(
    'Household income',
    f.incomeRange.map((v) => DETAILS_INCOME_LABEL[v]),
  )
  push(
    'Language',
    f.language.map((v) =>
      v === 'english' ? 'English' : v === 'spanish' ? 'Spanish' : 'Other',
    ),
  )
  push(
    'Ethnicity',
    f.ethnicity.map((v) => DETAILS_ETHNICITY_LABEL[v]),
  )
  push('Precinct', f.precinct)
  const lifestyle = (
    ['hasChildrenUnder18', 'veteran', 'homeowner', 'businessOwner'] as const
  ).flatMap((k) =>
    (f[k] as string[]).map((v) => (v === 'yes' ? TRI_POS[k]! : TRI_NEG[k]!)),
  )
  push('Household & lifestyle', lifestyle)
  return groups
}

const topBreakdown = <T extends string>(
  voters: Voter[],
  keyFn: (v: Voter) => T,
  labelFn: (k: T) => string,
) => {
  const counts = new Map<T, number>()
  for (const v of voters) {
    const k = keyFn(v)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: labelFn(key), count }))
    .sort((a, b) => b.count - a.count)
}

export const ListDetailsSheet = ({
  open,
  onOpenChange,
  list,
  kind,
  voters,
}: Props) => {
  const households = voters.length
  const people = voters.reduce((s, v) => s + getHouseholdCount(v), 0)
  const knocked = voters.filter((v) => v.reached).length
  const minutes = routeTotalMinutes(voters)
  const mode = listMode(voters)
  const area = boundaryLabel(voters)
  const groups = appliedFilterGroups(list?.filters)
  const customLabel = list?.customListId
    ? (CUSTOM_VOTER_LISTS.find((c) => c.id === list.customListId)?.label ??
      null)
    : null
  const isEmpty = groups.length === 0 && !customLabel
  const knockedPct =
    households > 0 ? Math.round((knocked / households) * 100) : 0
  const createdLabel = list?.createdAt
    ? new Date(list.createdAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null

  const supportBreak = topBreakdown(
    voters,
    (v) => v.support ?? 'unknown',
    (k) =>
      k === 'yes'
        ? 'Supporter'
        : k === 'no'
          ? 'Non-supporter'
          : 'Support unknown',
  )
  const partyBreak = topBreakdown(
    voters,
    (v) => v.party,
    (k) => PARTY_LABEL[k],
  )
  const ageBreak = AGE_BUCKETS.map((b) => ({
    key: b.key,
    label: b.label,
    count: voters.filter((v) => b.test(v.age)).length,
  })).sort((a, b) => b.count - a.count)
  const issueCounts = new Map<string, number>()
  for (const v of voters)
    for (const i of v.topIssues)
      issueCounts.set(i, (issueCounts.get(i) ?? 0) + 1)
  const issueBreak = [...issueCounts.entries()]
    .filter(([k]) => ISSUES.includes(k))
    .map(([key, count]) => ({ key, label: key, count }))
    .sort((a, b) => b.count - a.count)

  const pct = (c: number) =>
    people > 0 ? Math.round((c / households) * 100) : 0
  const top = <T,>(arr: { key: T; label: string; count: number }[]) =>
    arr.length ? arr[0]! : null
  const topSupport = top(supportBreak)
  const topParty = top(partyBreak)
  const topAge = top(ageBreak)
  const topIssue = top(issueBreak)

  const highlights: { label: string; pct: number }[] = []
  const pushHi = (
    arr: { label: string; count: number }[],
    fmt: (l: string) => string,
  ) =>
    arr.slice(0, 2).forEach((i) => {
      const p = pct(i.count)
      if (p > 0) highlights.push({ label: fmt(i.label), pct: p })
    })
  pushHi(partyBreak, (l) => l)
  pushHi(ageBreak, (l) => `aged ${l}`)
  pushHi(issueBreak, (l) => `care about ${l}`)

  const description =
    list?.reason ??
    (kind === 'saved'
      ? 'Overview of this list, its route, and applied filters.'
      : 'Why we recommend this list and how it was built.')

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="flex h-[calc(100dvh-4rem)] flex-col p-0 data-[vaul-drawer-direction=bottom]:mt-0 data-[vaul-drawer-direction=bottom]:max-h-[calc(100dvh-4rem)] lg:h-[calc(100dvh-8rem)] lg:data-[vaul-drawer-direction=bottom]:max-h-[calc(100dvh-8rem)]">
        <DrawerHandle />
        <DrawerHeader className="sr-only">
          <DrawerTitle>{list?.name ?? 'List'}</DrawerTitle>
        </DrawerHeader>

        <div className="border-border shrink-0 border-b px-4 py-4 lg:px-6">
          <div className="mx-auto w-full max-w-[608px]">
            {kind === 'recommended' && (
              <span className="text-primary bg-primary/10 mb-1.5 inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-semibold tracking-wide uppercase">
                <Sparkles className="size-3" />
                Recommended
              </span>
            )}
            <h2 className="text-foreground text-base font-semibold">
              {list?.name ?? 'List'}
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">{description}</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-5 lg:px-6">
          <div className="mx-auto w-full max-w-[608px] space-y-6">
            {/* Applied filters */}
            <section className="space-y-3">
              <SectionLabel>Applied filters</SectionLabel>
              {isEmpty ? (
                <p className="text-muted-foreground text-sm">
                  No filters applied — this list targets all contacts.
                </p>
              ) : (
                <div className="space-y-4">
                  {customLabel && (
                    <FilterGroup title="Custom voter list">
                      <Badge variant="secondary" shape="pill">
                        {customLabel}
                      </Badge>
                    </FilterGroup>
                  )}
                  {groups.map((g) => (
                    <FilterGroup key={g.title} title={g.title}>
                      {g.values.map((v) => (
                        <Badge key={v} variant="secondary" shape="pill">
                          {v}
                        </Badge>
                      ))}
                    </FilterGroup>
                  ))}
                </div>
              )}
            </section>

            {/* Overview */}
            <section className="space-y-3">
              <SectionLabel>Overview</SectionLabel>
              <dl className="grid grid-cols-2 gap-3">
                <Metric
                  icon={Home}
                  label="Households"
                  value={households.toLocaleString()}
                />
                <Metric
                  icon={Users}
                  label="People"
                  value={people.toLocaleString()}
                />
                <Metric
                  icon={Clock}
                  label="Estimated time"
                  value={formatDuration(minutes)}
                />
                <Metric
                  icon={mode === 'drive' ? Car : Footprints}
                  label="Route type"
                  value={mode === 'drive' ? 'Drive route' : 'Walk route'}
                />
                {area && <Metric icon={MapPin} label="Area" value={area} />}
                {createdLabel && (
                  <Metric
                    icon={Calendar}
                    label="Created"
                    value={createdLabel}
                  />
                )}
              </dl>
              {kind === 'saved' && (
                <Card className="flex-row items-start gap-2 p-3">
                  <CheckCircle2 className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-muted-foreground text-xs">Progress</p>
                    <p className="text-foreground text-sm font-medium">
                      {knocked.toLocaleString()} of{' '}
                      {households.toLocaleString()} · {knockedPct}%
                    </p>
                    <Progress value={knockedPct} className="mt-2 h-1.5" />
                  </div>
                </Card>
              )}
            </section>

            {/* Why we recommend */}
            {kind === 'recommended' && list?.reason && (
              <section className="space-y-2">
                <SectionLabel>Why we recommend it</SectionLabel>
                <p className="text-foreground text-sm leading-relaxed">
                  {list.reason}
                </p>
              </section>
            )}

            {/* Audience snapshot */}
            {people > 0 && (
              <section className="space-y-4">
                <div className="space-y-3">
                  <SectionLabel>Audience snapshot</SectionLabel>
                  <Card className="p-4">
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
                      <StatCell
                        label="People"
                        value={people.toLocaleString()}
                      />
                      {topSupport && (
                        <StatCell
                          label="Top support"
                          value={topSupport.label}
                          sub={`${pct(topSupport.count)}%`}
                        />
                      )}
                      {topParty && (
                        <StatCell
                          label="Top party"
                          value={topParty.label}
                          sub={`${pct(topParty.count)}%`}
                        />
                      )}
                      {topAge && (
                        <StatCell
                          label="Top age"
                          value={topAge.label}
                          sub={`${pct(topAge.count)}%`}
                        />
                      )}
                      {topIssue && (
                        <StatCell
                          label="Top issue"
                          value={topIssue.label}
                          sub={`${pct(topIssue.count)}%`}
                        />
                      )}
                    </dl>
                  </Card>
                </div>
                {highlights.length > 0 && (
                  <div className="space-y-3">
                    <SectionLabel>Demographic highlights</SectionLabel>
                    <Card className="p-4">
                      <ul className="space-y-2">
                        {highlights.map((h, i) => (
                          <li
                            key={`${h.label}-${i}`}
                            className="text-foreground flex items-baseline gap-2 text-sm"
                          >
                            <span className="bg-muted-foreground mt-0.5 size-1 shrink-0 rounded-full" />
                            <span>
                              <span className="font-medium tabular-nums">
                                {h.pct}%
                              </span>{' '}
                              {h.label}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}

const FilterGroup = ({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) => (
  <div className="space-y-1.5">
    <p className="text-muted-foreground text-xs font-medium">{title}</p>
    <div className="flex flex-wrap gap-1.5">{children}</div>
  </div>
)

const Metric = ({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  value: string
}) => (
  <Card className="flex-row items-start gap-2 p-3">
    <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
    <div className="min-w-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-foreground text-sm font-medium">{value}</dd>
    </div>
  </Card>
)

const StatCell = ({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub?: string
}) => (
  <div className="min-w-0">
    <dt className="text-muted-foreground text-xs">{label}</dt>
    <dd className="mt-0.5 flex items-baseline gap-1.5">
      <span className="text-foreground truncate text-base font-medium">
        {value}
      </span>
      {sub && (
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {sub}
        </span>
      )}
    </dd>
  </div>
)
