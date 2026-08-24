import type { RoutePayloadTarget } from '@goodparty_org/contracts'
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

// packEncoder's AGE_VALUES, verbatim — the pack ships raw bucket keys, so
// both branches below speak those and only presentation turns them into prose.
const AGE_BUCKET_LABELS: Record<string, string> = {
  Unknown: 'Unknown',
  '18_25': '18–25',
  '25_35': '25–35',
  '35_50': '35–50',
  '50_plus': '50+',
}

export const ageBucketLabel = (bucket: string): string =>
  AGE_BUCKET_LABELS[bucket] ?? bucket

// Mirrors gp-api's `encodeAge` bound for bound: shared inclusive edges resolve
// to the younger bucket, and an under-18 row reads Unknown because no age
// filter matches it, so no bucket may either. Duplicated rather than imported
// because the encoder is a server module — but the two MUST agree, or knocking
// a list would silently re-shape its own age breakdown while the audience
// behind it never moved.
const ageBucket = (age: number | null): string =>
  age === null || age < 18
    ? 'Unknown'
    : age <= 25
      ? '18_25'
      : age <= 35
        ? '25_35'
        : age <= 50
          ? '35_50'
          : '50_plus'

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
