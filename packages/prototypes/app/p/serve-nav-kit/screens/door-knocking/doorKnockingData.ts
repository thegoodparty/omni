// Door-knocking data — fully SYNTHETIC (no real voter PII). The source app is
// backed by a real Blanco County, TX contact file; per GoodParty's voter-data
// rules we generate fake residents with the same shape instead.

export type Support = 'yes' | 'no' | 'unknown'
export type DoorOutcome = 'answered' | 'not_home' | 'not_accessible'
export type Party = 'D' | 'R' | 'I' | 'U'

export type Voter = {
  id: string
  name: string
  address: string
  party: Party
  precinct: string
  householdSize: number
  // Normalised 0–100 map position (synthetic — no real geocoding).
  x: number
  y: number
  reached?: boolean
  support?: Support
  outcome?: DoorOutcome
}

// -------------- Turf colors (six presets, matching the source) --------------
export type ListColor =
  | 'blue'
  | 'orange'
  | 'violet'
  | 'cyan'
  | 'magenta'
  | 'brown'
export const DEFAULT_LIST_COLOR: ListColor = 'blue'

export const LIST_COLOR_OPTIONS: {
  id: ListColor
  label: string
  hex: string
}[] = [
  { id: 'blue', label: 'Blue', hex: '#2563EB' },
  { id: 'orange', label: 'Orange', hex: '#F97316' },
  { id: 'violet', label: 'Purple', hex: '#8B5CF6' },
  { id: 'cyan', label: 'Cyan', hex: '#06B6D4' },
  { id: 'magenta', label: 'Magenta', hex: '#EC4899' },
  { id: 'brown', label: 'Brown', hex: '#8B5A2B' },
]

export const LIST_COLOR_HEX: Record<ListColor, string> =
  LIST_COLOR_OPTIONS.reduce(
    (acc, opt) => {
      acc[opt.id] = opt.hex
      return acc
    },
    {} as Record<ListColor, string>,
  )

export const darkenHex = (hex: string, amount = 40): string => {
  const h = hex.replace('#', '')
  const r = Math.max(0, parseInt(h.slice(0, 2), 16) - amount)
  const g = Math.max(0, parseInt(h.slice(2, 4), 16) - amount)
  const b = Math.max(0, parseInt(h.slice(4, 6), 16) - amount)
  return `rgb(${r},${g},${b})`
}

export const getHouseholdCount = (voter: Voter): number => voter.householdSize

// -------------- Synthetic voter universe --------------
const FIRST = [
  'James',
  'Mary',
  'Michael',
  'Patricia',
  'Robert',
  'Jennifer',
  'David',
  'Linda',
  'Maria',
  'Susan',
  'Daniel',
  'Karen',
  'Carlos',
  'Nancy',
  'Kevin',
  'Lisa',
  'Brian',
  'Sarah',
  'Andre',
  'Michelle',
  'Luis',
  'Emily',
  'Marcus',
  'Rebecca',
  'Aaron',
  'Amanda',
  'Diego',
  'Laura',
  'Trevor',
  'Nicole',
]
const LAST = [
  'Reyes',
  'Carter',
  'Nguyen',
  'Johnson',
  'Patel',
  'Garcia',
  'Miller',
  'Okafor',
  'Rossi',
  'Kim',
  'Brooks',
  'Delgado',
  'Foster',
  'Alvarez',
  'Bennett',
  'Cho',
  'Hughes',
  'Ramos',
  'Walsh',
  'Freeman',
]
const STREETS = [
  'Lonesome Loop',
  'Cedar Ridge Rd',
  'Maplewood Ave',
  'Willow Bend',
  'Oak Hollow Dr',
  'Pecan Grove Ln',
  'Riverside Way',
  'Ward 3 Blvd',
  'Bluebonnet St',
  'Sycamore Ct',
]
const PRECINCTS = ['Precinct 3', 'Precinct 4', 'Ward 3']
const PARTIES: Party[] = ['D', 'R', 'I', 'U']

export const DK_PRECINCTS: readonly string[] = PRECINCTS
export const DK_PARTIES: readonly Party[] = PARTIES

// Deterministic pseudo-random so the universe is stable across renders.
const seeded = (n: number) => {
  const x = Math.sin(n * 999) * 10000
  return x - Math.floor(x)
}

const buildVoters = (): Voter[] => {
  const out: Voter[] = []
  for (let i = 0; i < 220; i++) {
    const first = FIRST[Math.floor(seeded(i + 1) * FIRST.length)] ?? 'Alex'
    const last = LAST[Math.floor(seeded(i + 7) * LAST.length)] ?? 'Smith'
    const street =
      STREETS[Math.floor(seeded(i + 3) * STREETS.length)] ?? 'Main St'
    const num = 100 + Math.floor(seeded(i + 5) * 900)
    const precinctIdx = i % PRECINCTS.length
    const precinct = PRECINCTS[precinctIdx] ?? 'Precinct 3'
    const r = seeded(i + 11)
    // Cluster each precinct around a center so lists read as neighborhoods.
    const CENTERS = [
      { x: 26, y: 32 },
      { x: 70, y: 36 },
      { x: 46, y: 70 },
    ]
    const c = CENTERS[precinctIdx] ?? CENTERS[0]!
    out.push({
      id: `dk-${i}`,
      name: `${first} ${last}`,
      address: `${num} ${street}`,
      party: PARTIES[Math.floor(seeded(i + 13) * PARTIES.length)] ?? 'U',
      precinct,
      x: Math.round((c.x + (seeded(i + 19) - 0.5) * 34) * 10) / 10,
      y: Math.round((c.y + (seeded(i + 23) - 0.5) * 34) * 10) / 10,
      householdSize: 1 + Math.floor(seeded(i + 17) * 3),
      reached: r < 0.28 ? true : undefined,
      support:
        r < 0.16 ? 'yes' : r < 0.24 ? 'no' : r < 0.28 ? 'unknown' : undefined,
    })
  }
  return out
}

export const ALL_VOTERS: Voter[] = buildVoters()

const idsIn = (from: number, to: number) =>
  ALL_VOTERS.slice(from, to).map((v) => v.id)

// -------------- Lists --------------
export type DoorList = {
  id: string
  name: string
  voterIds: string[]
  color?: ListColor
  createdAt: string
  durationMin: number
  reason?: string
}

export const DOOR_GOAL = 1200

export const SAVED_LISTS: DoorList[] = [
  {
    id: 'list-lonesome-loop',
    name: 'Lonesome Loop — turnout push',
    voterIds: idsIn(0, 48),
    color: 'blue',
    createdAt: '2026-06-22',
    durationMin: 95,
  },
  {
    id: 'list-ward3-undecided',
    name: 'Ward 3 undecideds',
    voterIds: idsIn(120, 150),
    color: 'orange',
    createdAt: '2026-07-01',
    durationMin: 70,
  },
]

export const RECOMMENDED_LISTS: DoorList[] = [
  {
    id: 'rec-cedar-ridge',
    name: 'Cedar Ridge — high-turnout neighbors',
    voterIds: idsIn(48, 74),
    createdAt: '2026-07-20',
    durationMin: 60,
    reason:
      'Dense cluster of high-turnout households you haven’t canvassed yet — a short, efficient walk.',
  },
  {
    id: 'rec-riverside-swing',
    name: 'Riverside swing voters',
    voterIds: idsIn(150, 172),
    createdAt: '2026-07-20',
    durationMin: 55,
    reason:
      'Persuadable independents near your last route. Good follow-up while momentum is high.',
  },
]

export const votersFor = (list: DoorList): Voter[] => {
  const set = new Set(list.voterIds)
  return ALL_VOTERS.filter((v) => set.has(v.id))
}

// -------------- New-list filters --------------
export type ListFilters = {
  precincts: string[]
  parties: Party[]
  notReached: boolean
}

export const filterVoters = (f: ListFilters): Voter[] =>
  ALL_VOTERS.filter((v) => {
    if (f.precincts.length && !f.precincts.includes(v.precinct)) return false
    if (f.parties.length && !f.parties.includes(v.party)) return false
    if (f.notReached && v.reached) return false
    return true
  })

// Rough walking estimate: ~2 min per door, min 10.
export const estimatedMinutes = (count: number): number =>
  count === 0 ? 0 : Math.max(10, Math.round(count * 2))

export const fmtDuration = (min: number): string => {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

// -------------- Canvassing outcome model --------------
export type DoorRecord = {
  outcome: DoorOutcome
  support?: Support
  note?: string
}

export const OUTCOME_OPTIONS: { id: DoorOutcome; label: string }[] = [
  { id: 'answered', label: 'Answered' },
  { id: 'not_home', label: 'Not home' },
  { id: 'not_accessible', label: "Can't access" },
]

export const SUPPORT_OPTIONS: { id: Support; label: string }[] = [
  { id: 'yes', label: 'Supporter' },
  { id: 'unknown', label: 'Undecided' },
  { id: 'no', label: 'Not supporting' },
]

export const PARTY_LABEL: Record<Party, string> = {
  D: 'Democrat',
  R: 'Republican',
  I: 'Independent',
  U: 'Unaffiliated',
}

// Seed the canvass with the households already marked reached in the universe,
// so progress counts line up with the manage view on first load.
export const initialRecords = (): Record<string, DoorRecord> => {
  const recs: Record<string, DoorRecord> = {}
  for (const v of ALL_VOTERS) {
    if (v.reached) recs[v.id] = { outcome: 'answered', support: v.support }
  }
  return recs
}
