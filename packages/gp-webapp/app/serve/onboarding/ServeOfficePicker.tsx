'use client'

import {
  Button,
  FilterPill,
  FilterPillGroup,
  Input,
  InputWithButton,
  RadioCardItem,
  RadioGroup,
  Skeleton,
} from '@styleguide'
import { useQuery } from '@tanstack/react-query'
import Fuse, { type IFuseOptions } from 'fuse.js'
import { Loader2, Search } from 'lucide-react'
import { useMemo, useState, useEffect } from 'react'
import { clientFetch } from 'gpApi/clientFetch'
import { apiRoutes } from 'gpApi/routes'
import { dateUsHelper } from 'helpers/dateHelper'
import { reportErrorToSentry } from '@shared/sentry'
import type { Race } from 'app/onboarding/[slug]/[step]/components/ballotOffices/types'
import type { SelectedOffice } from 'app/onboarding/components/onboardingTypes'

// An elected official already holds the office, so this is a position picker,
// not a race picker. The list comes from upcoming races, which every covered
// position has. Past races only supply each row's "Last elected" date, the
// signal that tells apart cohort twins sharing an identical name.
const isZipValid = (value: string): boolean => /^\d{5}$/.test(value.trim())

interface PositionRow {
  positionId: string
  positionName: string
  level?: string
  city?: string
  state?: string
  lastElectedDate?: string
}

const FUSE_OPTIONS: IFuseOptions<PositionRow> = {
  keys: ['positionName'],
  threshold: 0.3,
  ignoreLocation: true,
  minMatchCharLength: 1,
  shouldSort: true,
  findAllMatches: true,
  isCaseSensitive: false,
}

// Category pills mirror the Serve Vision export: a fixed set of common office
// keywords, matched against each row's name by substring, plus an "Other"
// catch-all. Only pills with at least one matching office are shown.
const KNOWN_PILLS = [
  'City Council',
  'Mayor',
  'School Board',
  'Judge',
  'Sheriff',
  'State Senate',
] as const
const OTHER_PILL = 'Other'

const fetchRaces = async (
  zip: string,
  timeframe: 'future' | 'past',
): Promise<Race[]> => {
  const resp = await clientFetch<Race[]>(
    apiRoutes.elections.racesByYear,
    { zipcode: zip, timeframe },
    { revalidate: 3600 },
  )
  if (!resp.ok) {
    throw new Error(
      `racesByYear returned ${resp.status} ${resp.statusText}`.trim(),
    )
  }
  return Array.isArray(resp.data) ? resp.data : []
}

interface PositionRaces {
  upcoming: Race[]
  past: Race[]
}

// A failed past lookup only costs the dates, so it never fails the picker.
const fetchPositions = async (zip: string): Promise<PositionRaces> => {
  const [upcoming, past] = await Promise.all([
    fetchRaces(zip, 'future'),
    fetchRaces(zip, 'past').catch((error: Error) => {
      reportErrorToSentry(error, {
        context: 'serveOnboarding.officePicker.fetchPastRaces',
        zip,
      })
      return []
    }),
  ])
  return { upcoming, past }
}

const racePositionId = (race: Race): string | undefined =>
  race.brPositionId ?? race.position?.id

// The latest past general per position. Primaries and runoffs are not when
// an official was elected.
const lastElectedByPosition = (past: Race[]): Map<string, string> => {
  const byId = new Map<string, string>()
  for (const race of past) {
    if (race.isPrimary || race.isRunoff) continue
    const positionId = racePositionId(race)
    const day = race.election?.electionDay
    if (!positionId || !day) continue
    const current = byId.get(positionId)
    if (!current || day > current) byId.set(positionId, day)
  }
  return byId
}

// Collapse the upcoming race rows (one per position+election) into one row
// per position.
const dedupeToPositions = ({
  upcoming,
  past,
}: PositionRaces): PositionRow[] => {
  const lastElected = lastElectedByPosition(past)
  const byId = new Map<string, PositionRow>()

  for (const race of upcoming) {
    const positionId = racePositionId(race)
    if (!positionId || byId.has(positionId)) continue
    byId.set(positionId, {
      positionId,
      positionName: race.position?.name ?? 'Office',
      level: race.position?.level,
      city: race.city ?? undefined,
      state: race.position?.state ?? race.election?.state,
      lastElectedDate: lastElected.get(positionId),
    })
  }

  return [...byId.values()].sort((a, b) =>
    a.positionName.localeCompare(b.positionName),
  )
}

const matchesPill = (row: PositionRow, pill: string): boolean =>
  row.positionName.toLowerCase().includes(pill.toLowerCase())

const isOtherRow = (row: PositionRow): boolean =>
  !KNOWN_PILLS.some((pill) => matchesPill(row, pill))

const toSelectedOffice = (row: PositionRow): SelectedOffice => ({
  raceId: '',
  positionId: row.positionId,
  positionName: row.positionName,
  level: row.level,
  city: row.city,
  state: row.state,
})

interface ServeOfficePickerProps {
  zip: string | undefined
  selected: SelectedOffice | undefined
  onZipChange: (zip: string) => void
  onSelect: (office: SelectedOffice | undefined) => void
  onCantFindOffice: () => void
}

const PickerSkeleton = (): React.JSX.Element => (
  <div aria-label="Loading offices" className="space-y-3" role="status">
    <Skeleton className="h-10 w-full rounded-md" />
    <Skeleton className="h-16 w-full rounded-md" />
    <Skeleton className="h-16 w-full rounded-md" />
  </div>
)

const EmptyState = ({ message }: { message: string }): React.JSX.Element => (
  <p className="rounded-md border border-base-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
    {message}
  </p>
)

export default function ServeOfficePicker({
  zip,
  selected,
  onZipChange,
  onSelect,
  onCantFindOffice,
}: ServeOfficePickerProps): React.JSX.Element {
  const [zipInput, setZipInput] = useState(zip ?? '')
  const [submittedZip, setSubmittedZip] = useState<string | undefined>(zip)
  const [nameFilter, setNameFilter] = useState('')
  const [activePill, setActivePill] = useState<string | null>(null)

  const canSearch = isZipValid(zipInput)

  const query = useQuery({
    queryKey: ['serve-onboarding-positions', submittedZip],
    queryFn: () => fetchPositions(submittedZip as string),
    enabled: Boolean(submittedZip && isZipValid(submittedZip)),
  })

  useEffect(() => {
    if (!query.error) return
    reportErrorToSentry(query.error, {
      context: 'serveOnboarding.officePicker.fetchPositions',
      zip: submittedZip,
    })
  }, [query.error, submittedZip])

  const positions = useMemo(
    () => dedupeToPositions(query.data ?? { upcoming: [], past: [] }),
    [query.data],
  )

  const pillCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const pill of KNOWN_PILLS) {
      counts[pill] = positions.filter((row) => matchesPill(row, pill)).length
    }
    counts[OTHER_PILL] = positions.filter(isOtherRow).length
    return counts
  }, [positions])

  const sortedPills = useMemo(
    () =>
      [...KNOWN_PILLS, OTHER_PILL]
        .filter((pill) => (pillCounts[pill] ?? 0) > 0)
        .sort((a, b) => {
          if (a === OTHER_PILL) return 1
          if (b === OTHER_PILL) return -1
          return (pillCounts[b] ?? 0) - (pillCounts[a] ?? 0)
        }),
    [pillCounts],
  )

  const filteredPositions = useMemo(() => {
    let rows = positions
    if (activePill) {
      rows =
        activePill === OTHER_PILL
          ? rows.filter(isOtherRow)
          : rows.filter((row) => matchesPill(row, activePill))
    }
    if (!nameFilter.trim()) return rows
    const fuse = new Fuse(rows, FUSE_OPTIONS)
    return fuse.search(nameFilter.trim()).map((result) => result.item)
  }, [positions, nameFilter, activePill])

  const handleSearch = () => {
    if (!canSearch) return
    const cleaned = zipInput.trim()
    setSubmittedZip(cleaned)
    setNameFilter('')
    setActivePill(null)
    onZipChange(cleaned)
    onSelect(undefined)
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    handleSearch()
  }

  const showResults = Boolean(submittedZip) && query.isSuccess

  return (
    <div className="space-y-5 text-left">
      <form noValidate onSubmit={handleSubmit}>
        <InputWithButton
          label="ZIP code"
          inputMode="numeric"
          maxLength={5}
          pattern="[0-9]{5}"
          placeholder="Enter 5 digit zip code"
          value={zipInput}
          onChange={(event) =>
            setZipInput(event.target.value.replace(/\D/g, ''))
          }
          aria-invalid={
            query.isError || (Boolean(zipInput) && !canSearch) || undefined
          }
          buttonLabel="Search"
          buttonProps={{
            type: 'submit',
            disabled: !canSearch || query.isFetching,
            loading: query.isFetching,
          }}
        />
      </form>

      {!submittedZip && !query.isFetching ? (
        <EmptyState message="Enter your ZIP code above to find your office." />
      ) : null}

      {query.isFetching ? <PickerSkeleton /> : null}

      {query.isError ? (
        <EmptyState message="We couldn't load offices for that ZIP code. Try again." />
      ) : null}

      {showResults ? (
        <div className="space-y-4">
          <Input
            icon={<Search />}
            aria-label="Search by office name"
            placeholder="Search by office name"
            value={nameFilter}
            onChange={(event) => setNameFilter(event.target.value)}
            className="bg-muted/50"
          />

          {sortedPills.length > 0 ? (
            <FilterPillGroup
              aria-label="Filter offices by type"
              value={activePill ?? ''}
              onValueChange={(value) => setActivePill(value || null)}
            >
              {sortedPills.map((pill) => (
                <FilterPill key={pill} value={pill}>
                  {pill} ({pillCounts[pill] ?? 0})
                </FilterPill>
              ))}
            </FilterPillGroup>
          ) : null}

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {query.isFetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            {`${filteredPositions.length} office${
              filteredPositions.length === 1 ? '' : 's'
            } found`}
          </div>

          {filteredPositions.length === 0 ? (
            <EmptyState
              message={
                positions.length === 0
                  ? "We couldn't find any offices for that ZIP code. Enter your office manually below."
                  : 'No offices match that search. Try another term or enter your office manually below.'
              }
            />
          ) : (
            <RadioGroup
              aria-label="Available offices"
              className="max-h-[480px] overflow-y-auto p-1"
              value={selected?.positionId ?? ''}
              onValueChange={(positionId) => {
                const row = filteredPositions.find(
                  (candidate) => candidate.positionId === positionId,
                )
                if (row) onSelect(toSelectedOffice(row))
              }}
            >
              {filteredPositions.map((row) => (
                <RadioCardItem
                  key={row.positionId}
                  value={row.positionId}
                  id={`office-${row.positionId}`}
                  title={row.positionName}
                  description={
                    [
                      row.level,
                      row.lastElectedDate
                        ? `Last elected: ${dateUsHelper(row.lastElectedDate)}`
                        : undefined,
                    ]
                      .filter(Boolean)
                      .join(' · ') || undefined
                  }
                />
              ))}
            </RadioGroup>
          )}

          <div className="pt-1 text-center">
            <Button
              type="button"
              variant="link"
              size="small"
              onClick={onCantFindOffice}
            >
              I don&apos;t see my office
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
