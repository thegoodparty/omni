// Both read paths for a briefing artifact (`GET /meetings/:date/briefing` and
// the public PDF renderer) fetch from S3 and 404 on a miss — the JSONB copy on
// the row is only a cache. `MeetingBriefing.artifactBucket` / `artifactKey` are
// also NOT NULL, so there is no way to record "this briefing has no object":
// whatever a seed writes there, a reader will try to GET. A seeded briefing
// therefore has to land a real S3 object, not just a row.
//
// gp-api already writes to the meeting pipeline bucket for briefing speech
// audio (`speech/services/textToSpeech.service.ts`), so it is the bucket we are
// guaranteed to hold write access to in every non-prod deploy. Every deployed
// task definition sets MEETING_PIPELINE_BUCKET (`deploy/index.ts`), so the
// fallback only ever applies to local dev and vitest.
//
// This constant is shared rather than duplicated per seed service because the
// seed paths are the only writers that choose a bucket themselves — the agent
// path takes whatever the broker reports over SQS. Keeping the choice in one
// place is what makes "a seed cannot name a bucket we do not own" true by
// construction instead of by review. It was not: a briefing row written with
// the literal bucket "seed" (a real, unrelated bucket that resolves to
// ap-south-1) made `GET /v1/meetings/2026-07-01/briefing` fail 768 times over
// seven days in dev with S3 PermanentRedirect, and no code path could repair it
// because the row is what tells the reader where to look.
export const SEED_BUCKET =
  process.env.MEETING_PIPELINE_BUCKET ?? 'meeting-pipeline-dev'
