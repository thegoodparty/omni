// The voter pack's `age` dimension, derived from the saved-list age filters
// rather than chosen.
//
// ENG-10752 re-cut the age bands and BOTH generations of key are live: a list
// saved before it carries `age18_25`, one saved after carries `age18_24`, and
// gp-api's `voterFileFilter.utils.ts` deliberately keeps each key's original
// bounds because reinterpreting one would silently change an existing list's
// membership. So the pack cannot simply carry "the age bands" — there are two
// sets of them, they overlap, and it has to express every key in both exactly.
//
// It cannot approximate, either. `filtersToDimSelections` (gp-webapp) shades
// the map from these buckets while knock time evaluates the real ranges, so a
// bucket that is a near-miss for a key produces a map whose count disagrees
// with the list it is previewing — two answers to one question, and worse than
// the honest "the map can't shade this" the disclosure already offers.
//
// The resolution is to stop picking bands and CUT at every boundary either
// generation uses. Nine keys over the integers produce eight intervals, three
// of which are a single year wide, because the retired keys share their
// inclusive edges with each other (25 is in both `age18_25` and `age25_35`)
// and the current keys do not. Every key is then an exact union of them:
//
//   18_24  25  26_34  35  36_49  50  51_64  65_plus
//   |------ age18_25 -----|
//          |------ age25_35 -----|
//                        |------ age35_50 -----|
//                                       |----- age50Plus ------------|
//   |18_24-|  |-age25_34-|  |-age35_49-|  |-age50_64-|  |-age65Plus--|
//
// Being derived is the point. A tenth key added to the table below re-cuts the
// buckets to fit it, so the two cannot drift; a hand-written bucket list would
// have to be re-derived by hand, correctly, by whoever adds it.
//
// The cost is twenty bytes of manifest, measured: the plane is one byte per
// person either way, and nine values is nowhere near the 256 a byte holds.
// Only the dim's value list grew.
//
// Single-year buckets are a filtering vocabulary, not a display one —
// `groupAgeSlices` in gp-webapp's
// `audienceMix.ts` folds them back into the current generation's bands before
// anything renders a breakdown, so nobody is shown a "25" slice beside a
// "36-49" one.

// Every age filter key, with the EXACT bounds `voterFileFilter.utils.ts`
// resolves it to (inclusive both ends; `max: null` is unbounded above). This
// is the single source: gp-api builds its `ageInt` ranges from it, and the
// pack's buckets below are cut from it.
//
// Retired keys keep the bounds they were saved with. `age50Plus` means 50+,
// not 50-64, forever.
export const AGE_FILTER_KEY_RANGES = {
  age18_25: { min: 18, max: 25 },
  age25_35: { min: 25, max: 35 },
  age35_50: { min: 35, max: 50 },
  age50Plus: { min: 50, max: null },
  age18_24: { min: 18, max: 24 },
  age25_34: { min: 25, max: 34 },
  age35_49: { min: 35, max: 49 },
  age50_64: { min: 50, max: 64 },
  age65Plus: { min: 65, max: null },
} as const satisfies Record<string, { min: number; max: number | null }>

export type AgeFilterKey = keyof typeof AGE_FILTER_KEY_RANGES

// The generation ENG-10752 introduced, in order. These are the bands a
// breakdown is displayed in, and they partition 18+ exactly once — which the
// retired set does not, so it cannot be used for this.
export const CURRENT_AGE_FILTER_KEYS = [
  'age18_24',
  'age25_34',
  'age35_49',
  'age50_64',
  'age65Plus',
] as const satisfies readonly AgeFilterKey[]

// Byte 0, and the youngest age any filter key admits. An under-18 row
// (pre-registrant, bad data) reads Unknown because no age filter matches it,
// so no bucket may either.
export const PACK_AGE_UNKNOWN = 'Unknown'

const RANGES = Object.values(AGE_FILTER_KEY_RANGES)

// Every age at which some key's membership changes: a range starts at `min`
// and stops after `max`, so `max + 1` is a cut too.
const CUTS = [
  ...new Set(
    RANGES.flatMap(({ min, max }) => (max === null ? [min] : [min, max + 1])),
  ),
].sort((a, b) => a - b)

type AgeInterval = { min: number; max: number | null }

// Consecutive cuts bound one interval each; the last is unbounded above.
const INTERVALS: AgeInterval[] = CUTS.map((min, index) => ({
  min,
  max: index === CUTS.length - 1 ? null : (CUTS[index + 1] as number) - 1,
}))

const intervalName = ({ min, max }: AgeInterval): string =>
  max === null ? `${min}_plus` : min === max ? `${min}` : `${min}_${max}`

// The `age` dim's values, in byte order. Index 0 is Unknown, as every mapped
// dim's is.
export const PACK_AGE_BUCKETS: readonly string[] = [
  PACK_AGE_UNKNOWN,
  ...INTERVALS.map(intervalName),
]

// A byte per age, so encoding is one array read. This runs once per person in
// a 611,000-row pack build: scanning the intervals instead measured 3.0ms
// against this table's 2.0ms and the four hardcoded comparisons' 0.6ms. All
// three are noise beside a ~23s build — the table is here because the domain
// is 130 integers wide and a loop over it is simply the wrong shape, not
// because 1ms was worth buying.
const LAST_INDEXED_AGE = 130
const BYTE_BY_AGE = new Uint8Array(LAST_INDEXED_AGE + 1)
for (let age = CUTS[0] as number; age <= LAST_INDEXED_AGE; age += 1) {
  let index = 0
  while (
    index + 1 < INTERVALS.length &&
    age >= (INTERVALS[index + 1] as AgeInterval).min
  ) {
    index += 1
  }
  BYTE_BY_AGE[age] = index + 1
}

// age -> byte. Mirrored by gp-webapp's route-target bucketing, which reads the
// same table. Ages past the table clamp into the open-ended top bucket rather
// than reading Unknown — a 131-year-old is bad data, but `50+` and `65+` are
// unbounded above and must not quietly stop matching.
export const encodeAgeBucket = (age: number | null): number => {
  if (age === null || age < (CUTS[0] as number)) return 0
  return age > LAST_INDEXED_AGE
    ? INTERVALS.length
    : (BYTE_BY_AGE[age] as number)
}

const bucketsForRange = ({ min, max }: AgeInterval): string[] =>
  INTERVALS.filter(
    (interval) =>
      interval.min >= min &&
      (max === null || (interval.max ?? Infinity) <= max),
  ).map(intervalName)

// Which pack buckets each key selects. Exact by construction: the cuts above
// were placed at this table's own boundaries, so no key ever half-covers a
// bucket.
export const AGE_KEY_TO_PACK_BUCKETS: Record<AgeFilterKey, string[]> =
  Object.fromEntries(
    Object.entries(AGE_FILTER_KEY_RANGES).map(([key, range]) => [
      key,
      bucketsForRange(range),
    ]),
  ) as Record<AgeFilterKey, string[]>

// The bands a breakdown is DISPLAYED in: the current generation's ranges,
// named like buckets. Single-year buckets exist so filters can be exact, not
// so anyone is shown a "25" slice beside a "36-49" one.
export const PACK_AGE_BANDS: readonly string[] = CURRENT_AGE_FILTER_KEYS.map(
  (key) => intervalName(AGE_FILTER_KEY_RANGES[key]),
)

// Which band a pack bucket rolls up into. The current keys partition 18+ and
// the cuts include their boundaries, so every bucket lands in exactly one.
export const PACK_AGE_BUCKET_TO_BAND: Record<string, string> =
  Object.fromEntries(
    CURRENT_AGE_FILTER_KEYS.flatMap((key) => {
      const band = intervalName(AGE_FILTER_KEY_RANGES[key])
      return bucketsForRange(AGE_FILTER_KEY_RANGES[key]).map((bucket) => [
        bucket,
        band,
      ])
    }),
  )
