import {
  PACK_AGE_BUCKETS,
  PACK_AGE_BUCKET_TO_BAND,
  encodeAgeBucket,
  type RoutePayloadTarget,
} from '@goodparty_org/contracts'
import type { DimSlice } from './filterEngine'

// Party and age are the only two dimensions BOTH of this sheet's sources can
// answer. The pack carries fourteen more (education, income, ethnicity,
// marital status, veteran, homeowner…), but a frozen route's targets carry a
// live `age` and `politicalParty` and nothing else — so a breakdown built on
// the pack's full set would empty itself the moment the list was knocked, and
// a candidate would watch twelve dimensions disappear as a reward for walking.
// Two dimensions that survive the lock beat fourteen that don't.
//
// The prototype's third and fourth groups have no honest equivalent here.
// "Top issues" is not a fact this product holds about a voter — no pack dim,
// no route field, no column. Its "support" breakdown is the landing rail's
// seven canvass-status chips, already scoped to this same list by
// `canvassStatusCounts`; reporting the same seven numbers again in a second
// visual form on a surface opened from that rail is how two presentations of
// one quantity start disagreeing.

// The pack ships raw bucket keys and both branches below speak them, so only
// presentation turns them into prose. The current generation's five bands
// come from contracts; the four legacy spellings stay because a pack built
// before the age re-cut still ships them, and a breakdown must render rather
// than blank out during a deploy.
const AGE_BUCKET_LABELS: Record<string, string> = {
  Unknown: 'Unknown',
  '18_24': '18–24',
  '25_34': '25–34',
  '35_49': '35–49',
  '50_64': '50–64',
  '65_plus': '65+',
  '18_25': '18–25',
  '25_35': '25–35',
  '35_50': '35–50',
  '50_plus': '50+',
}

export const ageBucketLabel = (bucket: string): string =>
  AGE_BUCKET_LABELS[bucket] ?? bucket

// The pack's age buckets are cut at every boundary BOTH generations of
// saved-list age key use, so three of them are a single year wide (25, 35, 50)
// — the price of every key mapping onto them exactly. That is a filtering
// vocabulary, and showing it would put a one-year slice next to a fourteen-year
// one in a breakdown nobody asked to see cut that way, so slices roll up into
// the current generation's bands before anything renders them.
//
// A bucket with no band (the legacy spellings above, from a pack built before
// the re-cut) passes through as itself: it is already a displayable band, and
// inventing a mapping onto the new bands would re-shape a real breakdown.
export const groupAgeSlices = (slices: DimSlice[]): DimSlice[] => {
  const banded = new Map<string, number>()
  for (const { label, people } of slices) {
    const band = PACK_AGE_BUCKET_TO_BAND[label] ?? label
    banded.set(band, (banded.get(band) ?? 0) + people)
  }
  return [...banded]
    .map(([label, people]) => ({ label, people }))
    .sort((a, b) => b.people - a.people)
}

// The frozen-route mirror of the pack's bucketing, rolled up the same way, so
// a list's age breakdown does not re-shape itself as a reward for walking it.
// It reads contracts' table rather than restating bounds — the duplicate this
// replaces was one `encodeAge` change away from silently disagreeing.
const ageBucket = (age: number | null): string => {
  const bucket = PACK_AGE_BUCKETS[encodeAgeBucket(age)] as string
  return PACK_AGE_BUCKET_TO_BAND[bucket] ?? bucket
}

// A live target with no row behind it (mayHaveMoved) carries a null party, and
// that is genuinely unknown rather than 'Other' — which here means a party we
// hold that isn't one of the three ruled ones. The pack cannot draw that
// distinction (its encoder folds display-'Other' into byte 0 alongside blanks),
// so a knocked list can show one bucket more than its unknocked self did. That
// is the frozen route being more precise, which is the same reason its counts
// stop being hedged, and not a vocabulary drift to paper over by degrading it.
const partyBucket = (target: RoutePayloadTarget): string =>
  target.politicalParty ?? 'Unknown'

const toMix = (buckets: string[]): DimSlice[] => {
  const counts = new Map<string, number>()
  for (const bucket of buckets) {
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
  }
  return [...counts]
    .map(([label, people]) => ({ label, people }))
    .sort((a, b) => b.people - a.people)
}

// Biggest bucket first and empty buckets dropped, exactly as `polygonStats`
// builds the pre-route pair, so the two branches render through one component
// without it having to know which source it was handed.
//
// Callers pass `knockableTargets`, never the raw stops: every people figure on
// this surface drops ADR 0007 do-not-knock and ADR 0008 not-a-voter residents,
// and a breakdown summing to a different total than the People stat above it
// is two answers to one question.
export const routeAudienceMix = (
  targets: RoutePayloadTarget[],
): { partyMix: DimSlice[]; ageMix: DimSlice[] } => ({
  partyMix: toMix(targets.map(partyBucket)),
  ageMix: toMix(targets.map((target) => ageBucket(target.age))),
})
