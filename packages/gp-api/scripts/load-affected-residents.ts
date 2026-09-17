/**
 * Validate an affected-residents list and upload it to the bucket the
 * community-issues module reads.
 *
 * These lists are individual-level L2 records, built one at a time by the
 * serve-lists runbook. They are deliberately NOT committed to this repo: a list
 * in git puts real names, street addresses and phone numbers into repository
 * history permanently, and history is not practically reversible. So the file
 * is built outside the repo and this script puts it where gp-api reads it, at
 * `affected-residents/<communityIssueId>.json`.
 *
 * The validation is the point, not the upload. `AffectedResidentsService`
 * refuses a list that fails the schema and logs an error, which at read time
 * looks identical to "this office has no list" — a silent nothing on the
 * officeholder's page. Failing here instead, before the object exists, is the
 * difference between a build error and a mystery.
 *
 * Usage:
 *   npx tsx scripts/load-affected-residents.ts \
 *     --file ../../my-list.json \
 *     --issue 01a099cd-33fc-7e82-b99c-565c8773df0e
 *
 *   Dry run by default — validates, prints a summary, writes and uploads
 *   nothing. Add --execute to upload.
 *
 * Options:
 *   --file <path>    The list JSON. Required. Must be the list itself, not a
 *                    map keyed by issue id: the id is already the object key.
 *   --issue <id>     The community issue id this list belongs to. Required,
 *                    and checked against the payload's own communityIssueId —
 *                    the service refuses a mismatch, so catch it here.
 *   --bucket <name>  Overrides AFFECTED_RESIDENTS_BUCKET.
 *   --execute        Actually upload.
 *
 * Required env vars:
 *   AFFECTED_RESIDENTS_BUCKET — unless --bucket is passed. Must match the
 *     value gp-api runs with, or gp-api will read a different bucket.
 *   AWS credentials in the usual places, with PutObject on that bucket.
 */

import { readFileSync } from 'node:fs'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import {
  AffectedResidentsList,
  AffectedResidentsListSchema,
} from '../src/communityIssues/schemas/affectedResidents.schema'

const KEY_PREFIX = 'affected-residents'

type Args = {
  file: string
  issue: string
  bucket?: string
  execute: boolean
}

const parseArgs = (argv: string[]): Args => {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`)
    return i === -1 ? undefined : argv[i + 1]
  }

  const file = get('file')
  const issue = get('issue')
  if (!file || !issue) {
    throw new Error(
      'usage: load-affected-residents.ts --file <path> --issue <communityIssueId> [--bucket <name>] [--execute]',
    )
  }
  return {
    file,
    issue,
    bucket: get('bucket'),
    execute: argv.includes('--execute'),
  }
}

// Recompute the affectedness score from the declared weights under the
// runbook's own rule: divide by the weight of the factors PRESENT, so a null
// factor leaves both sums rather than scoring zero. The schema cannot check
// this (it does not know the arithmetic), and a list whose printed score
// disagrees with its own factors is not one to hand an officeholder.
const worstScoreError = (list: AffectedResidentsList): number => {
  const weights = new Map(list.issue.factors.map((f) => [f.key, f.weight]))
  let worst = 0
  for (const resident of list.residents) {
    let numerator = 0
    let denominator = 0
    for (const [key, weight] of weights) {
      const value = resident.factorScores[key]
      if (value !== null && value !== undefined) {
        numerator += weight * value
        denominator += weight
      }
    }
    if (denominator === 0) return Number.POSITIVE_INFINITY
    const recomputed = Number((numerator / denominator).toFixed(3))
    worst = Math.max(worst, Math.abs(recomputed - resident.affectednessScore))
  }
  return worst
}

const summarise = (list: AffectedResidentsList): void => {
  const { issue, residents } = list
  const missing = issue.factors
    .map((f) => ({
      label: f.label,
      n: residents.filter((r) => r.factorScores[f.key] === null).length,
    }))
    .filter((f) => f.n > 0)
  const rankingDiffers = residents.filter(
    (r) => Math.abs(r.affectednessScore - r.rankingScore) > 0.0005,
  ).length

  console.log(`issue      : ${issue.title}`)
  console.log(`issue id   : ${issue.communityIssueId}`)
  console.log(`office     : ${issue.organizationSlug}`)
  console.log(`run date   : ${issue.runDate}  (source: ${issue.sourceList})`)
  console.log(`residents  : ${residents.length}`)
  console.log(
    `factors    : ${issue.factors.map((f) => `${f.key}@${f.weight}`).join(', ')}`,
  )
  console.log(`caveats    : ${issue.caveats.length}`)
  console.log(
    `dropped    : ${
      missing.length === 0
        ? 'no factor is null on any resident'
        : missing
            .map((f) => `${f.n} have no ${f.label.toLowerCase()}`)
            .join('; ')
    }`,
  )
  // Worth printing rather than burying: when these two disagree the page shows
  // the ranking note, and a reviewer should know that before it ships.
  console.log(
    `ranking    : differs from the affectedness score on ${rankingDiffers} of ${residents.length} residents`,
  )
}

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2))
  const bucket = args.bucket ?? process.env.AFFECTED_RESIDENTS_BUCKET

  const parsed = AffectedResidentsListSchema.safeParse(
    JSON.parse(readFileSync(args.file, 'utf8')) as unknown,
  )
  if (!parsed.success) {
    console.error('list failed validation — gp-api would refuse to serve it:')
    console.error(JSON.stringify(parsed.error.issues, null, 2))
    process.exit(1)
  }
  const list = parsed.data

  if (list.issue.communityIssueId !== args.issue) {
    console.error(
      `--issue is ${args.issue} but the payload says ${list.issue.communityIssueId}.` +
        ' gp-api checks the payload against the key it was found under and would refuse this.',
    )
    process.exit(1)
  }

  const error = worstScoreError(list)
  if (error > 1e-9) {
    console.error(
      `affectedness scores do not match the declared factor weights (worst error ${error}).` +
        ' Either the weights or the scores are wrong; do not upload.',
    )
    process.exit(1)
  }

  summarise(list)

  const key = `${KEY_PREFIX}/${args.issue}.json`
  console.log(`\ns3 key     : ${key}`)
  console.log(`bucket     : ${bucket ?? '(unset)'}`)

  if (!args.execute) {
    console.log('\nDry run. Nothing uploaded. Re-run with --execute to upload.')
    return
  }
  if (!bucket) {
    console.error(
      '\nno bucket: set AFFECTED_RESIDENTS_BUCKET or pass --bucket. It must match the value gp-api runs with.',
    )
    process.exit(1)
  }

  const client = new S3Client({ region: process.env.AWS_REGION ?? 'us-west-2' })
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(list),
      ContentType: 'application/json',
    }),
  )
  console.log(`\nuploaded to s3://${bucket}/${key}`)
}

void main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})
