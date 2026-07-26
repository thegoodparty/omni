// Door-knocking data — fully SYNTHETIC (no real voter PII). The Lovable source
// is backed by a real Blanco County, TX contact file (voterContacts.json with
// real names/addresses). Per GoodParty's voter/L2-data rules we do NOT reproduce
// individual records: instead we generate fake residents with the same shape and
// synthetic lat/lng, so every helper (routing, filters, households) ports 1:1.

// -------------- Enums --------------
export type Support = 'yes' | 'no' | 'unknown'
export type WillVote = 'yes' | 'no' | 'unknown'
export type DoorOutcome = 'answered' | 'not_home' | 'not_accessible'
export type Engagement = 'engaged' | 'refused' | 'other'
export type MaritalStatus = 'single' | 'married' | 'divorced' | 'widowed'
export type VoterStatus = 'active' | 'inactive'
export type Education = 'highschool' | 'some_college' | 'bachelors' | 'graduate'
export type IncomeRange = '<50k' | '50-100k' | '100-150k' | '150k+'
export type Language = 'english' | 'spanish' | 'other'
export type Ethnicity = 'white' | 'hispanic' | 'black' | 'asian' | 'other'
export type Party = 'D' | 'R' | 'I' | 'U'

export type ActivityKind =
  | 'knocked'
  | 'called'
  | 'texted'
  | 'emailed'
  | 'voice_note'

export type ActivityEntry = {
  kind: ActivityKind
  label: string
  detail?: string
  notes?: string
  at: string
  residentId?: string
}

export type ResidentStatus = {
  reached?: boolean
  outcome?: DoorOutcome
  support?: Support
  willVote?: WillVote
  engagement?: Engagement
  note?: string
}

export type Voter = {
  id: string
  name: string
  address: string
  age: number
  party: Party
  topIssues: string[]
  lat: number
  lng: number
  // local meters projection (for routing math)
  x: number
  y: number
  registered: boolean
  voterStatus: VoterStatus
  maritalStatus: MaritalStatus
  hasChildrenUnder18: boolean
  veteran: boolean
  homeowner: boolean
  businessOwner: boolean
  education: Education
  incomeRange: IncomeRange
  language: Language
  ethnicity: Ethnicity
  phone: string | null
  email: string | null
  precinct: string
  reached?: boolean
  outcome?: DoorOutcome
  support?: Support
  willVote?: WillVote
  engagement?: Engagement
  note?: string
  activity?: ActivityEntry[]
  residentStatuses?: Record<string, ResidentStatus>
  removedResidents?: Record<string, { reason: 'moved' | 'opt_out'; at: string }>
}

// -------------- Turf colors (six presets) --------------
// Turf colors come from the design system's palette families (not raw hex),
// so list coding stays on-brand and theme-aware.
export type ListColor =
  | 'blue'
  | 'orange'
  | 'violet'
  | 'cyan'
  | 'magenta'
  | 'brown'

export const DEFAULT_LIST_COLOR: ListColor = 'blue'

// Source turf palette (Blue/Orange/Purple/Cyan/Magenta/Brown) mapped onto DS
// palette tokens — Magenta is pink-500 (the source's exact #EC4899); Brown ≈
// amber-800 (no brown token in the DS, so the nearest brown-ish shade).
export const LIST_COLOR_OPTIONS: {
  id: ListColor
  label: string
  token: string
}[] = [
  { id: 'blue', label: 'Blue', token: 'var(--color-blue-600)' },
  { id: 'orange', label: 'Orange', token: 'var(--color-orange-500)' },
  { id: 'violet', label: 'Purple', token: 'var(--color-violet-500)' },
  { id: 'cyan', label: 'Cyan', token: 'var(--color-cyan-500)' },
  { id: 'magenta', label: 'Magenta', token: 'var(--color-pink-500)' },
  { id: 'brown', label: 'Brown', token: 'var(--color-amber-800)' },
]

export const LIST_COLOR_TOKEN: Record<ListColor, string> =
  LIST_COLOR_OPTIONS.reduce(
    (acc, opt) => {
      acc[opt.id] = opt.token
      return acc
    },
    {} as Record<ListColor, string>,
  )

// -------------- Pin / status color tokens --------------
// Source uses parallel --map-pin-* CSS vars; we map each outcome to a DS token
// so the map, legend, and per-resident dots all read from the design system.
export type StatusColor =
  | 'green'
  | 'crimson'
  | 'orange'
  | 'red'
  | 'purple'
  | 'slate'

// bg-* class per status color (foreground dots / legend). `red` (reached but
// support-unknown) is a mid grey — distinct from the lighter "not visited" grey.
export const STATUS_DOT: Record<StatusColor, string> = {
  green: 'bg-success', // Supporter — green
  crimson: 'bg-destructive', // Non-supporter — red
  orange: 'bg-yellow-400', // Not home — yellow (source map-pin-orange)
  red: 'bg-muted-foreground/50', // Support unknown — light grey
  purple: 'bg-muted-foreground', // Inaccessible — darker grey
  slate: 'bg-foreground', // Refused — black
}

// fill-* class per status color (SVG map pins).
export const STATUS_FILL: Record<StatusColor, string> = {
  green: 'fill-success',
  crimson: 'fill-destructive',
  orange: 'fill-yellow-400',
  red: 'fill-muted-foreground/50',
  purple: 'fill-muted-foreground',
  slate: 'fill-foreground',
}

// -------------- Issues --------------
export const ISSUES = [
  'Affordable housing',
  'Public safety',
  'Parks & green space',
  'Property taxes',
  'Traffic & transit',
  'Schools',
  'Small business',
  'Climate',
]

// -------------- Synthetic universe --------------
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
  'Bluebonnet St',
  'Sycamore Ct',
  'Ward 3 Blvd',
]
const PRECINCTS = ['Precinct 1', 'Precinct 2', 'Precinct 3', 'Precinct 4']
const PARTIES: Party[] = ['D', 'R', 'I', 'U']

// Synthetic projection origin (a generic town centroid — coordinates are fake).
const CENTER_LAT = 30.098
const CENTER_LNG = -98.422
const M_PER_DEG_LAT = 111_320
const M_PER_DEG_LNG = 111_320 * Math.cos((CENTER_LAT * Math.PI) / 180)

export const DISTRICT_CENTER = { lat: CENTER_LAT, lng: CENTER_LNG }
export const DEFAULT_MAP_CENTER = { lat: CENTER_LAT, lng: CENTER_LNG }

export const xyToLatLng = (p: { x: number; y: number }) => ({
  lat: CENTER_LAT - p.y / M_PER_DEG_LAT,
  lng: CENTER_LNG + p.x / M_PER_DEG_LNG,
})

export const latLngToXy = (p: { lat: number; lng: number }) => ({
  x: Math.round((p.lng - CENTER_LNG) * M_PER_DEG_LNG),
  y: Math.round(-(p.lat - CENTER_LAT) * M_PER_DEG_LAT),
})

// Deterministic pseudo-random so the universe is stable across renders.
const seeded = (n: number) => {
  const x = Math.sin(n * 999.13) * 10000
  return x - Math.floor(x)
}

// Precinct cluster centers in meters (so lists read as neighborhoods).
const CLUSTER_CENTERS = [
  { x: -1100, y: -800 },
  { x: 1100, y: -700 },
  { x: -900, y: 900 },
  { x: 1000, y: 950 },
]

const N_VOTERS = 440

const buildVoters = (): Voter[] => {
  const out: Voter[] = []
  for (let i = 0; i < N_VOTERS; i++) {
    const first = FIRST[Math.floor(seeded(i + 1) * FIRST.length)] ?? 'Alex'
    const last = LAST[Math.floor(seeded(i + 7) * LAST.length)] ?? 'Smith'
    const street =
      STREETS[Math.floor(seeded(i + 3) * STREETS.length)] ?? 'Main St'
    const num = 100 + Math.floor(seeded(i + 5) * 900)
    const precinctIdx = i % PRECINCTS.length
    const precinct = PRECINCTS[precinctIdx] ?? 'Precinct 1'
    const center = CLUSTER_CENTERS[precinctIdx] ?? CLUSTER_CENTERS[0]!
    const x = Math.round(center.x + (seeded(i + 19) - 0.5) * 1500)
    const y = Math.round(center.y + (seeded(i + 23) - 0.5) * 1200)
    const { lat, lng } = xyToLatLng({ x, y })

    const age = 22 + Math.floor(seeded(i + 29) * 55)
    const pick = <T>(arr: readonly T[], off = 0): T =>
      arr[Math.floor(seeded(i + off) * arr.length)] ?? arr[0]!
    const chance = (p: number, off: number) => seeded(i + off) < p

    const issues: string[] = []
    const nIssues = 1 + Math.floor(seeded(i + 31) * 2)
    // `seeded` is a pure function, so the seed must advance every attempt or a
    // repeated draw would loop forever. Vary by attempt and cap attempts.
    for (let attempt = 0; issues.length < nIssues && attempt < 24; attempt++) {
      const cand =
        ISSUES[Math.floor(seeded(i * 13 + attempt * 7 + 37) * ISSUES.length)]!
      if (!issues.includes(cand)) issues.push(cand)
    }
    if (issues.length === 0) issues.push(ISSUES[i % ISSUES.length]!)

    const maritalStatus: MaritalStatus =
      age < 26
        ? pick(['single', 'single', 'married'] as const, 41)
        : age < 65
          ? pick(['married', 'married', 'single', 'divorced'] as const, 43)
          : pick(['married', 'widowed', 'divorced'] as const, 47)

    out.push({
      id: `dk-${i}`,
      name: `${first} ${last}`,
      address: `${num} ${street}, Rivertown, TX 78600`,
      age,
      party: PARTIES[Math.floor(seeded(i + 13) * PARTIES.length)] ?? 'U',
      topIssues: issues,
      lat,
      lng,
      x,
      y,
      registered: chance(0.86, 53),
      voterStatus: chance(0.82, 59) ? 'active' : 'inactive',
      maritalStatus,
      hasChildrenUnder18:
        age >= 22 && age <= 55 ? chance(0.45, 61) : chance(0.05, 61),
      veteran: chance(0.09, 67),
      homeowner: age >= 30 ? chance(0.72, 71) : chance(0.25, 71),
      businessOwner: chance(0.11, 73),
      education: pick(
        [
          'highschool',
          'highschool',
          'some_college',
          'bachelors',
          'bachelors',
          'graduate',
        ] as const,
        79,
      ),
      incomeRange: pick(
        ['<50k', '50-100k', '50-100k', '100-150k', '150k+'] as const,
        83,
      ),
      language: chance(0.78, 89)
        ? 'english'
        : chance(0.6, 91)
          ? 'spanish'
          : 'other',
      ethnicity: pick(
        [
          'white',
          'white',
          'hispanic',
          'hispanic',
          'black',
          'asian',
          'other',
        ] as const,
        97,
      ),
      phone: chance(0.7, 101) ? '555-555-0100' : null,
      email: chance(0.5, 103)
        ? `${first.toLowerCase()}.${last.toLowerCase()}@example.com`
        : null,
      precinct,
    })
  }
  return out
}

// Seed a realistic slice of canvass progress so the manage map, legend and
// list progress read as an active campaign (source starts empty; a working
// prototype needs a lived-in map). Deterministic.
const seedProgress = (voters: Voter[]): Voter[] =>
  voters.map((v, i) => {
    const r = seeded(i + 211)
    if (r >= 0.34) return v
    if (r < 0.05) return { ...v, reached: true, outcome: 'not_accessible' }
    if (r < 0.12) return { ...v, reached: true, outcome: 'not_home' }
    const s = seeded(i + 223)
    if (s < 0.1)
      return { ...v, reached: true, outcome: 'answered', engagement: 'refused' }
    const support: Support = s < 0.6 ? 'yes' : s < 0.82 ? 'no' : 'unknown'
    return {
      ...v,
      reached: true,
      outcome: 'answered',
      engagement: 'engaged',
      support,
      willVote: support === 'yes' ? 'yes' : 'unknown',
    }
  })

export const ALL_VOTERS: Voter[] = seedProgress(buildVoters())

const allPrecincts = [...new Set(ALL_VOTERS.map((v) => v.precinct))].sort()
export const PRECINCT_OPTIONS: ReadonlyArray<{ value: string; label: string }> =
  allPrecincts.map((p) => ({ value: p, label: p }))

// -------------- Lists --------------
export type List = {
  id: string
  name: string
  voterIds: string[]
  polygon: { x: number; y: number }[]
  createdAt: string
  color?: ListColor
  reason?: string
  filters?: CutFilters | null
  customListId?: string | null
}

export const DOOR_GOAL = 1200
export const RECOMMENDED_MAX_DOORS = 30
export const MAX_LIST_HOUSEHOLDS = 150
export const ALL_CONTACTS_ID = 'all'

const bboxPolygon = (
  voters: Voter[],
  pad = 140,
): { x: number; y: number }[] => {
  if (voters.length === 0) return []
  const xs = voters.map((v) => v.x)
  const ys = voters.map((v) => v.y)
  const minX = Math.min(...xs) - pad
  const maxX = Math.max(...xs) + pad
  const minY = Math.min(...ys) - pad
  const maxY = Math.max(...ys) + pad
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ]
}

const votersInBox = (center: { x: number; y: number }, half: number): Voter[] =>
  ALL_VOTERS.filter(
    (v) => Math.abs(v.x - center.x) <= half && Math.abs(v.y - center.y) <= half,
  )

const boxPolygon = (
  center: { x: number; y: number },
  half: number,
): { x: number; y: number }[] => [
  { x: center.x - half, y: center.y - half },
  { x: center.x + half, y: center.y - half },
  { x: center.x + half, y: center.y + half },
  { x: center.x - half, y: center.y + half },
]

// Recommendations are polygon-first: grow a box around a center until it holds
// ~target doors (capped at RECOMMENDED_MAX_DOORS), so the card count == the
// pre-drawn area == the draw selection. Small steps avoid overshooting the cap.
const recList = (
  id: string,
  name: string,
  reason: string,
  center: { x: number; y: number },
  target = 24,
): List => {
  // Grow in small steps and stop as soon as we reach the target so the box
  // stays under RECOMMENDED_MAX_DOORS while polygon == voterIds exactly.
  let half = 160
  let voters = votersInBox(center, half)
  while (voters.length < target && half < 1600) {
    half += 30
    voters = votersInBox(center, half)
  }
  return {
    id,
    name,
    reason,
    voterIds: voters.map((v) => v.id),
    polygon: boxPolygon(center, half),
    createdAt: '2026-07-20',
  }
}

// Nearest-N voters to a cluster center that match a predicate — used to seed
// saved lists as compact walkable neighborhoods.
const clusterList = (
  center: { x: number; y: number },
  count: number,
  predicate: (v: Voter) => boolean = () => true,
): Voter[] =>
  ALL_VOTERS.filter(predicate)
    .map((v) => ({
      v,
      d: (v.x - center.x) ** 2 + (v.y - center.y) ** 2,
    }))
    .sort((a, b) => a.d - b.d)
    .slice(0, count)
    .map((e) => e.v)

const makeList = (
  id: string,
  name: string,
  voters: Voter[],
  extra: Partial<List> = {},
): List => ({
  id,
  name,
  voterIds: voters.map((v) => v.id),
  polygon: bboxPolygon(voters),
  createdAt: '2026-06-22',
  ...extra,
})

export const SAMPLE_LISTS: List[] = [
  makeList(
    'list-lonesome-loop',
    'Lonesome Loop — turnout push',
    clusterList(CLUSTER_CENTERS[0]!, 42),
    { color: 'blue', createdAt: '2026-06-22' },
  ),
  makeList(
    'list-ward3-undecided',
    'Ward 3 undecideds',
    clusterList(CLUSTER_CENTERS[3]!, 28, (v) => v.support !== 'yes'),
    { color: 'orange', createdAt: '2026-07-01' },
  ),
]

export const RECOMMENDED_LISTS: List[] = [
  recList(
    'rec-housing',
    'Affordable housing supporters',
    'Housing is your #1 campaign issue — these neighbors flagged it as their top concern.',
    { x: 950, y: -950 },
  ),
  recList(
    'rec-parents',
    'Parents with kids under 18',
    'Your education platform resonates strongest with parents — high persuasion score.',
    { x: -1050, y: 800 },
  ),
  recList(
    'rec-veterans',
    'Veterans',
    'Underserved by your opponent and aligned with your veterans-services plan.',
    { x: 1150, y: 1050 },
  ),
]

export const votersFor = (list: List): Voter[] => {
  const set = new Set(list.voterIds)
  return ALL_VOTERS.filter((v) => set.has(v.id))
}

// -------------- Filters --------------
export type CutFilters = {
  issue: string[]
  registered: string[]
  voterStatus: VoterStatus[]
  party: { D: boolean; R: boolean; I: boolean; U: boolean }
  maritalStatus: MaritalStatus[]
  hasChildrenUnder18: string[]
  veteran: string[]
  homeowner: string[]
  businessOwner: string[]
  education: Education[]
  incomeRange: IncomeRange[]
  language: Language[]
  ethnicity: Ethnicity[]
  reached: 'any' | 'reached' | 'not_reached'
  ageRange: string[]
  voterCategory: string[]
  precinct: string[]
  support: Support[]
}

export const DEFAULT_FILTERS: CutFilters = {
  issue: [],
  registered: [],
  voterStatus: [],
  party: { D: false, R: false, I: false, U: false },
  maritalStatus: [],
  hasChildrenUnder18: [],
  veteran: [],
  homeowner: [],
  businessOwner: [],
  education: [],
  incomeRange: [],
  language: [],
  ethnicity: [],
  reached: 'any',
  ageRange: [],
  voterCategory: [],
  precinct: [],
  support: [],
}

export const hasActiveFilters = (f: CutFilters): boolean => {
  const partySelected = f.party.D || f.party.R || f.party.I || f.party.U
  return (
    partySelected ||
    f.reached !== 'any' ||
    f.issue.length > 0 ||
    f.registered.length > 0 ||
    f.voterStatus.length > 0 ||
    f.maritalStatus.length > 0 ||
    f.hasChildrenUnder18.length > 0 ||
    f.veteran.length > 0 ||
    f.homeowner.length > 0 ||
    f.businessOwner.length > 0 ||
    f.education.length > 0 ||
    f.incomeRange.length > 0 ||
    f.language.length > 0 ||
    f.ethnicity.length > 0 ||
    f.ageRange.length > 0 ||
    f.voterCategory.length > 0 ||
    f.precinct.length > 0 ||
    f.support.length > 0
  )
}

const ageRangeMatches = (r: string, v: Voter): boolean => {
  switch (r) {
    case '18-34':
      return v.age >= 18 && v.age <= 34
    case '35-50':
      return v.age >= 35 && v.age <= 50
    case '50+':
      return v.age >= 50
    case '51-64':
      return v.age >= 51 && v.age <= 64
    case '65+':
      return v.age >= 65
    default:
      return true
  }
}

const voterCategoryMatches = (c: string, v: Voter): boolean => {
  if (c === 'super_voter') return v.homeowner && v.age >= 40
  if (c === 'likely_voter') return v.age >= 18 && v.age <= 35
  return true
}

export const matchesFilters = (v: Voter, f: CutFilters): boolean => {
  const partySelected = f.party.D || f.party.R || f.party.I || f.party.U
  if (partySelected && !f.party[v.party]) return false
  if (f.issue.length && !f.issue.some((i) => v.topIssues.includes(i)))
    return false
  if (
    f.registered.length &&
    !f.registered.includes(v.registered ? 'yes' : 'no')
  )
    return false
  if (f.voterStatus.length && !f.voterStatus.includes(v.voterStatus))
    return false
  if (f.maritalStatus.length && !f.maritalStatus.includes(v.maritalStatus))
    return false
  if (
    f.hasChildrenUnder18.length &&
    !f.hasChildrenUnder18.includes(v.hasChildrenUnder18 ? 'yes' : 'no')
  )
    return false
  if (f.veteran.length && !f.veteran.includes(v.veteran ? 'yes' : 'no'))
    return false
  if (f.homeowner.length && !f.homeowner.includes(v.homeowner ? 'yes' : 'no'))
    return false
  if (
    f.businessOwner.length &&
    !f.businessOwner.includes(v.businessOwner ? 'yes' : 'no')
  )
    return false
  if (f.education.length && !f.education.includes(v.education)) return false
  if (f.incomeRange.length && !f.incomeRange.includes(v.incomeRange))
    return false
  if (f.language.length && !f.language.includes(v.language)) return false
  if (f.ethnicity.length && !f.ethnicity.includes(v.ethnicity)) return false
  if (f.reached === 'reached' && !v.reached) return false
  if (f.reached === 'not_reached' && v.reached) return false
  if (f.ageRange.length && !f.ageRange.some((r) => ageRangeMatches(r, v)))
    return false
  if (
    f.voterCategory.length &&
    !f.voterCategory.some((c) => voterCategoryMatches(c, v))
  )
    return false
  if (f.precinct.length && !f.precinct.includes(v.precinct)) return false
  if (f.support.length && !f.support.includes(v.support ?? 'unknown'))
    return false
  return true
}

export const countMatching = (universe: Voter[], f: CutFilters): number => {
  let n = 0
  for (const v of universe) if (matchesFilters(v, f)) n++
  return n
}

// -------------- Custom voter lists (base universe options) --------------
export type CustomVoterList = {
  id: string
  label: string
  predicate: (v: Voter) => boolean
}

export const CUSTOM_VOTER_LISTS: CustomVoterList[] = [
  {
    id: 'custom-a',
    label: 'Custom List A — Homeowners 40+',
    predicate: (v) => v.homeowner && v.age >= 40,
  },
  {
    id: 'custom-b',
    label: 'Custom List B — Young voters (18–35)',
    predicate: (v) => v.age >= 18 && v.age <= 35,
  },
]

export const universeFor = (customListId: string | null): Voter[] => {
  if (!customListId || customListId === ALL_CONTACTS_ID) return ALL_VOTERS
  const custom = CUSTOM_VOTER_LISTS.find((c) => c.id === customListId)
  return custom ? ALL_VOTERS.filter(custom.predicate) : ALL_VOTERS
}

// -------------- Filter option arrays (value + label, in source order) --------------
export const SUPPORT_OPTIONS = [
  { value: 'yes', label: 'Supporter' },
  { value: 'no', label: 'Non-supporter' },
  { value: 'unknown', label: 'Support unknown' },
]
export const AGE_RANGE_OPTIONS = [
  { value: '18-34', label: '18–34' },
  { value: '35-50', label: '35–50' },
  { value: '50+', label: '50+' },
  { value: '51-64', label: '51–64' },
  { value: '65+', label: '65+' },
]
export const VOTER_CATEGORY_OPTIONS = [
  { value: 'super_voter', label: 'Super voters' },
  { value: 'likely_voter', label: 'Likely voters' },
]
export const TRI_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
]
export const VOTER_STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]
export const MARITAL_OPTIONS = [
  { value: 'single', label: 'Single' },
  { value: 'married', label: 'Married' },
  { value: 'divorced', label: 'Divorced' },
  { value: 'widowed', label: 'Widowed' },
]
export const EDUCATION_OPTIONS = [
  { value: 'highschool', label: 'High school' },
  { value: 'some_college', label: 'Some college' },
  { value: 'bachelors', label: "Bachelor's" },
  { value: 'graduate', label: 'Graduate' },
]
export const INCOME_OPTIONS = [
  { value: '<50k', label: 'Under $50k' },
  { value: '50-100k', label: '$50k–$100k' },
  { value: '100-150k', label: '$100k–$150k' },
  { value: '150k+', label: '$150k+' },
]
export const LANGUAGE_OPTIONS = [
  { value: 'english', label: 'English' },
  { value: 'spanish', label: 'Spanish' },
  { value: 'other', label: 'Other' },
]
export const ETHNICITY_OPTIONS = [
  { value: 'white', label: 'White' },
  { value: 'hispanic', label: 'Hispanic or Latino' },
  { value: 'black', label: 'Black or African American' },
  { value: 'asian', label: 'Asian' },
  { value: 'other', label: 'Other' },
]
export const PARTY_OPTIONS: { value: Party; label: string }[] = [
  { value: 'D', label: 'Democrat' },
  { value: 'R', label: 'Republican' },
  { value: 'I', label: 'Independent' },
  { value: 'U', label: 'Other' },
]

export const PARTY_LABEL: Record<Party, string> = {
  D: 'Democrat',
  R: 'Republican',
  I: 'Independent',
  U: 'Other',
}

// -------------- Households / residents --------------
const HH_MALE = [
  'James',
  'Michael',
  'David',
  'Robert',
  'John',
  'Daniel',
  'Anthony',
  'Mark',
  'Steven',
  'Kevin',
  'Brian',
]
const HH_FEMALE = [
  'Mary',
  'Jennifer',
  'Linda',
  'Patricia',
  'Susan',
  'Karen',
  'Nancy',
  'Lisa',
  'Sarah',
  'Laura',
  'Emily',
]
const HH_CHILD = [
  'Ethan',
  'Olivia',
  'Liam',
  'Emma',
  'Noah',
  'Ava',
  'Mason',
  'Sophia',
  'Lucas',
  'Mia',
]

const hashString = (s: string): number => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export const getHouseholdMembers = (voter: Voter): string[] => {
  const seed = hashString(voter.id + voter.name)
  const pick = <T>(arr: readonly T[], off = 0): T =>
    arr[(seed + off) % arr.length]!
  const parts = voter.name.trim().split(/\s+/)
  const lastName = parts.slice(-1)[0] ?? ''
  const firstName = parts[0] ?? voter.name
  const guessedFemale = HH_FEMALE.includes(firstName)
  const spouseFirst = guessedFemale ? pick(HH_MALE) : pick(HH_FEMALE, 3)

  const members: string[] = [voter.name.trim()]
  if (voter.maritalStatus === 'married')
    members.push(`${spouseFirst} ${lastName}`.trim())
  if (voter.hasChildrenUnder18) {
    const childCount = 1 + ((seed >> 3) % 2)
    for (let i = 0; i < childCount; i++)
      members.push(`${pick(HH_CHILD, i * 5 + 1)} ${lastName}`.trim())
  }
  const removed = voter.removedResidents ?? {}
  return members.filter((_, i) => !removed[`${voter.id}-resident-${i}`])
}

export const getHouseholdCount = (voter: Voter): number =>
  getHouseholdMembers(voter).length

export type Resident = Pick<
  Voter,
  | 'id'
  | 'name'
  | 'age'
  | 'party'
  | 'topIssues'
  | 'hasChildrenUnder18'
  | 'veteran'
  | 'homeowner'
  | 'businessOwner'
  | 'registered'
  | 'voterStatus'
  | 'maritalStatus'
  | 'education'
  | 'incomeRange'
  | 'language'
  | 'ethnicity'
> & { relation?: 'self' | 'spouse' | 'child' }

export const residentGender = (name: string): 'Male' | 'Female' => {
  const firstName = name.trim().split(/\s+/)[0] ?? ''
  if (HH_FEMALE.includes(firstName)) return 'Female'
  if (HH_MALE.includes(firstName)) return 'Male'
  return name.length % 2 === 0 ? 'Male' : 'Female'
}

export const getResidents = (voter: Voter): Resident[] => {
  const rawMembers = getHouseholdMembers({
    ...voter,
    removedResidents: undefined,
  })
  const seed = hashString(voter.id + voter.name)
  const pick = <T>(arr: readonly T[], off = 0): T =>
    arr[(seed + off) % arr.length]!
  const out: Resident[] = []
  for (let i = 0; i < rawMembers.length; i++) {
    const residentId = `${voter.id}-resident-${i}`
    if (voter.removedResidents?.[residentId]) continue
    const name = rawMembers[i]!
    const relation: Resident['relation'] =
      i === 0
        ? 'self'
        : i === 1 && voter.maritalStatus === 'married'
          ? 'spouse'
          : 'child'
    const isChild = relation === 'child'
    const age =
      relation === 'self'
        ? voter.age
        : relation === 'spouse'
          ? Math.max(18, voter.age + (seed % 9) - 4)
          : Math.max(5, 12 + ((seed + i * 7) % 18))
    out.push({
      id: residentId,
      name,
      age,
      party: voter.party,
      topIssues: voter.topIssues,
      hasChildrenUnder18:
        relation === 'self' ? voter.hasChildrenUnder18 : false,
      veteran: relation === 'self' ? voter.veteran : false,
      homeowner: relation === 'self' ? voter.homeowner : false,
      businessOwner: relation === 'self' ? voter.businessOwner : false,
      registered: relation === 'self' ? voter.registered : age >= 18,
      voterStatus: voter.voterStatus,
      maritalStatus:
        relation === 'spouse'
          ? 'married'
          : relation === 'child'
            ? 'single'
            : voter.maritalStatus,
      education:
        relation === 'self'
          ? voter.education
          : isChild
            ? 'highschool'
            : pick(['highschool', 'some_college', 'bachelors'] as const),
      incomeRange: voter.incomeRange,
      language: voter.language,
      ethnicity: voter.ethnicity,
      relation,
    })
  }
  return out
}

// -------------- Routing / geometry --------------
const inPoly = (
  p: { x: number; y: number },
  poly: { x: number; y: number }[],
) => {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]!.x
    const yi = poly[i]!.y
    const xj = poly[j]!.x
    const yj = poly[j]!.y
    const intersect =
      yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

export const votersInPolygon = (
  voters: Voter[],
  poly: { x: number; y: number }[],
): Voter[] => voters.filter((v) => inPoly({ x: v.x, y: v.y }, poly))

export const legMeta = (
  a: { x: number; y: number },
  b: { x: number; y: number },
) => {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const meters = Math.round(Math.sqrt(dx * dx + dy * dy))
  const walkMin = meters / 80
  const driveMin = meters / 400 + 1
  const mode: 'walk' | 'drive' = walkMin > 5 ? 'drive' : 'walk'
  return { meters, walkMin, driveMin, mode }
}

export const buildRoute = (voters: Voter[]): Voter[] => {
  if (voters.length === 0) return []
  const remaining = [...voters]
  const route: Voter[] = []
  let current = remaining.shift()!
  route.push(current)
  while (remaining.length) {
    let bestIdx = 0
    let bestD = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const dx = remaining[i]!.x - current.x
      const dy = remaining[i]!.y - current.y
      const d = dx * dx + dy * dy
      if (d < bestD) {
        bestD = d
        bestIdx = i
      }
    }
    current = remaining.splice(bestIdx, 1)[0]!
    route.push(current)
  }
  return route
}

export const listMode = (voters: Voter[]): 'walk' | 'drive' => {
  if (voters.length < 2) return 'walk'
  const route = buildRoute(voters)
  for (let i = 1; i < route.length; i++)
    if (legMeta(route[i - 1]!, route[i]!).mode === 'drive') return 'drive'
  return 'walk'
}

export const routeTotalMinutes = (route: Voter[]): number => {
  let total = 2
  const mode = listMode(route)
  for (let i = 1; i < route.length; i++) {
    const leg = legMeta(route[i - 1]!, route[i]!)
    total += mode === 'walk' ? leg.walkMin : leg.driveMin
    total += 2
  }
  return Math.round(total)
}

export const estimatedMinutes = (count: number): number =>
  count === 0 ? 0 : Math.max(10, count * 2)

export const formatDuration = (minutes: number): string => {
  const rounded = Math.ceil(minutes)
  const h = Math.floor(rounded / 60)
  const m = rounded % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

// -------------- Outcome meta + counts --------------
export const getDoorOutcomeMeta = (
  status: Pick<Voter, 'reached' | 'outcome' | 'engagement' | 'support'>,
): { label: string; color: StatusColor } | null => {
  if (!status.reached) return null
  if (status.outcome === 'not_accessible')
    return { label: 'Inaccessible', color: 'purple' }
  if (status.outcome === 'not_home')
    return { label: 'Not home', color: 'orange' }
  if (status.outcome === 'answered') {
    if (status.engagement === 'refused')
      return { label: 'Refused', color: 'slate' }
    if (status.support === 'yes') return { label: 'Supporter', color: 'green' }
    if (status.support === 'no')
      return { label: 'Non-supporter', color: 'crimson' }
    return { label: 'Support unknown', color: 'red' }
  }
  return null
}

export type VoterCounts = Record<StatusColor, number>

export const getVoterCounts = (voters: Voter[]): VoterCounts => {
  const total = voters.length
  const answered = voters.filter((v) => v.reached && v.outcome === 'answered')
  const green = answered.filter(
    (v) => v.engagement !== 'refused' && v.support === 'yes',
  ).length
  const crimson = answered.filter(
    (v) => v.engagement !== 'refused' && v.support === 'no',
  ).length
  const slate = answered.filter((v) => v.engagement === 'refused').length
  const orange = voters.filter(
    (v) => v.reached && v.outcome === 'not_home',
  ).length
  const purple = voters.filter(
    (v) => v.reached && v.outcome === 'not_accessible',
  ).length
  const red = total - green - crimson - slate - orange - purple
  return { green, crimson, orange, red, purple, slate }
}

// -------------- Talking points --------------
export const getTalkingPoints = (voter: Resident): string[] => {
  const firstName = voter.name.split(' ')[0]
  const points: string[] = []
  points.push(
    `Introduce yourself to ${firstName} and thank them for taking a moment at the door.`,
  )
  if (voter.hasChildrenUnder18)
    points.push(
      'Ask about their family — highlight your plan to invest in local schools and safe neighborhoods.',
    )
  if (voter.veteran)
    points.push(
      'Thank them for their service and mention your commitment to expanding veteran benefits and services.',
    )
  if (voter.homeowner)
    points.push(
      'Bring up property taxes and infrastructure — share how your plan protects homeowners.',
    )
  if (voter.businessOwner)
    points.push(
      'Ask how business has been and share your ideas to support small businesses in the district.',
    )
  if (voter.party === 'D')
    points.push(
      'Lean into shared priorities: healthcare access, public education, and protecting local jobs.',
    )
  else if (voter.party === 'R')
    points.push(
      'Emphasize fiscal responsibility, public safety, and cutting red tape for families and businesses.',
    )
  else
    points.push(
      'Focus on independent issues — accountable government, lower costs, and results over party politics.',
    )
  if (voter.age >= 60)
    points.push(
      'Ask what matters most to them right now — mention protecting Social Security and Medicare.',
    )
  else if (voter.age <= 35)
    points.push(
      'Ask about housing affordability and job opportunities — share your plan for younger residents.',
    )
  points.push(
    `Close by asking if ${firstName} plans to vote and whether you can count on their support.`,
  )
  return points.slice(0, 6)
}

// -------------- Detail labels --------------
export const MARITAL_LABEL: Record<MaritalStatus, string> = {
  single: 'Single',
  married: 'Married',
  divorced: 'Divorced',
  widowed: 'Widowed',
}
export const EDUCATION_LABEL: Record<Education, string> = {
  highschool: 'High school',
  some_college: 'Some college',
  bachelors: "Bachelor's",
  graduate: 'Graduate',
}
export const INCOME_LABEL: Record<IncomeRange, string> = {
  '<50k': 'Under $50k',
  '50-100k': '$50k – $100k',
  '100-150k': '$100k – $150k',
  '150k+': '$150k+',
}
export const LANGUAGE_LABEL: Record<Language, string> = {
  english: 'English',
  spanish: 'Spanish',
  other: 'Other',
}
export const ETHNICITY_LABEL: Record<Ethnicity, string> = {
  white: 'White',
  hispanic: 'Hispanic',
  black: 'Black',
  asian: 'Asian',
  other: 'Other',
}
export const VOTER_STATUS_LABEL: Record<VoterStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
}
