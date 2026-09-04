/**
 * Add a list of user emails to an Amplitude Experiment flag's targeting
 * segment, so a named pilot cohort resolves to a given variant.
 *
 * Why a targeting segment and not the flag's inclusion list: Amplitude's
 * inclusions match on user ID or device ID, and gp-webapp identifies the
 * experiment user by `String(user.id)` with the email carried as a user
 * property (FeatureFlagsProvider.tsx / buildUserTraits.ts). A list of emails
 * pasted into inclusions would match nobody, silently.
 *
 * The read-merge-write is the point of this script. `PATCH /flags/{id}`
 * REPLACES the whole `targetSegments` array rather than appending to it, so
 * writing a cohort by hand is how you delete the cohort that was already
 * there. This reads the flag first, unions the new addresses into the named
 * segment, and sends every other segment back untouched.
 *
 * Usage:
 *   npx tsx scripts/amplitude-flag-cohort.ts \
 *     --flag native-door-knocking \
 *     --emails-file ./cohort.txt          # one address per line, # comments ok
 *
 *   Dry run by default — prints the diff and writes nothing. Add --execute.
 *
 * Options:
 *   --flag <key>            Flag key. Required.
 *   --emails-file <path>    File of addresses, one per line. Required.
 *   --variant <key>         Variant the cohort resolves to. Default: on
 *   --segment <name>        Segment to merge into. Default: "Pilot allowlist"
 *   --verify-accounts       Check each address against the users table first,
 *                           and refuse to write if any has no account.
 *   --allow-unknown         With --verify-accounts, warn instead of refusing.
 *   --execute               Actually write.
 *
 * Required env vars:
 *   AMPLITUDE_MANAGEMENT_API_KEY — Experiment > Management API in Amplitude.
 *     This is NOT the deployment key in NEXT_PUBLIC_AMPLITUDE_API_KEY.
 *   DATABASE_URL — only with --verify-accounts.
 */

import { z } from 'zod'
import { PrismaClient } from '../src/generated/prisma'

const API_ROOT = 'https://experiment.amplitude.com/api/1'

// Amplitude namespaces custom and free-form user properties with `gp:`. Email
// reaches Amplitude as a user property (buildUserTraits.ts), not a built-in.
const EMAIL_PROP = 'gp:email'

const DEFAULT_SEGMENT_NAME = 'Pilot allowlist'
const DEFAULT_VARIANT = 'on'

// ── Types ────────────────────────────────────────────────────────────────────

const FlagConditionSchema = z.object({
  type: z.string(),
  prop: z.string(),
  op: z.string(),
  values: z.array(z.string()),
})

// `.passthrough()` on both, deliberately. Read responses carry fields the PATCH
// body doesn't document (a per-segment `bucketingKey`), and this array is sent
// back wholesale — stripping to the documented shape would reset those on every
// run. An unexpected field rejected loudly by the API beats silent drift.
const FlagSegmentSchema = z
  .object({
    name: z.string(),
    conditions: z.array(FlagConditionSchema).default([]),
    percentage: z.number(),
    rolloutWeights: z.record(z.string(), z.number()).optional(),
  })
  .passthrough()

const FlagSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    key: z.string(),
    targetSegments: z.array(FlagSegmentSchema).default([]),
  })
  .passthrough()

const FlagListSchema = z.object({ flags: z.array(FlagSchema).default([]) })

export type FlagCondition = z.infer<typeof FlagConditionSchema>
export type FlagSegment = z.infer<typeof FlagSegmentSchema>
export type Flag = z.infer<typeof FlagSchema>

export interface MergeResult {
  segments: FlagSegment[]
  added: string[]
  alreadyPresent: string[]
  createdSegment: boolean
}

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

// Addresses are compared and stored lowercased. Amplitude's `is` operator is an
// exact string match, so "Jane@Example.com" in the segment never matches the
// "jane@example.com" the app sends through buildUserTraits.
export const parseEmails = (contents: string): string[] => {
  const seen = new Set<string>()
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.split('#')[0].trim()
    if (!line) continue
    // Tolerates "Name <addr>" and bare addresses, which is how these lists
    // arrive from CS.
    const match = line.match(/[^\s<>,;]+@[^\s<>,;]+/)
    if (!match) continue
    seen.add(match[0].toLowerCase())
  }
  return [...seen]
}

const isEmailCondition = (condition: FlagCondition): boolean =>
  condition.prop === EMAIL_PROP && condition.op === 'is'

// A cohort-backed segment cannot survive this round trip: the API's own docs
// say `targetSegments` "doesn't support cohorts", so sending one back would
// drop it. Refuse rather than quietly unpick somebody's cohort targeting.
export const findCohortSegment = (
  segments: FlagSegment[],
): FlagSegment | undefined =>
  segments.find((segment) =>
    segment.conditions.some((condition) => condition.type !== 'property'),
  )

export const mergeCohortIntoSegments = (
  segments: FlagSegment[],
  {
    segmentName,
    variant,
    emails,
  }: { segmentName: string; variant: string; emails: string[] },
): MergeResult => {
  const existing = segments.find((segment) => segment.name === segmentName)

  if (!existing) {
    return {
      segments: [
        ...segments,
        {
          name: segmentName,
          conditions: [
            { type: 'property', prop: EMAIL_PROP, op: 'is', values: emails },
          ],
          percentage: 100,
          rolloutWeights: { [variant]: 1 },
        },
      ],
      added: emails,
      alreadyPresent: [],
      createdSegment: true,
    }
  }

  const emailCondition = existing.conditions.find(isEmailCondition)
  if (!emailCondition) {
    throw new Error(
      `Segment "${segmentName}" exists but has no ${EMAIL_PROP} "is" condition. ` +
        `Refusing to guess how to merge — inspect the flag in Amplitude.`,
    )
  }

  const current = new Set(emailCondition.values.map((v) => v.toLowerCase()))
  const added = emails.filter((email) => !current.has(email))
  const alreadyPresent = emails.filter((email) => current.has(email))

  return {
    segments: segments.map((segment) =>
      segment === existing
        ? {
            ...segment,
            conditions: segment.conditions.map((condition) =>
              condition === emailCondition
                ? {
                    ...condition,
                    values: [...emailCondition.values, ...added],
                  }
                : condition,
            ),
          }
        : segment,
    ),
    added,
    alreadyPresent,
    createdSegment: false,
  }
}

// ── Arg parsing ──────────────────────────────────────────────────────────────

interface Args {
  flag: string
  emailsFile: string
  variant: string
  segment: string
  verifyAccounts: boolean
  allowUnknown: boolean
  execute: boolean
}

const parseArgs = (argv: string[]): Args => {
  const value = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`)
    return index === -1 ? undefined : argv[index + 1]
  }
  const flag = value('flag')
  const emailsFile = value('emails-file')
  if (!flag || !emailsFile) {
    throw new Error(
      'Both --flag and --emails-file are required. See the header of this file.',
    )
  }
  return {
    flag,
    emailsFile,
    variant: value('variant') ?? DEFAULT_VARIANT,
    segment: value('segment') ?? DEFAULT_SEGMENT_NAME,
    verifyAccounts: argv.includes('--verify-accounts'),
    allowUnknown: argv.includes('--allow-unknown'),
    execute: argv.includes('--execute'),
  }
}

// ── Amplitude API ────────────────────────────────────────────────────────────

const request = async (
  path: string,
  key: string,
  init?: RequestInit,
): Promise<unknown> => {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  const body = await response.text()
  if (!response.ok) {
    throw new Error(
      `${init?.method ?? 'GET'} ${path} → ${response.status}: ${body}`,
    )
  }
  return body ? JSON.parse(body) : undefined
}

const findFlag = async (key: string, apiKey: string): Promise<Flag> => {
  const { flags } = FlagListSchema.parse(
    await request(`/flags?key=${encodeURIComponent(key)}`, apiKey),
  )
  const matches = flags.filter((flag) => flag.key === key)
  if (matches.length === 0) {
    throw new Error(`No flag with key "${key}" is visible to this API key.`)
  }
  // A management key is scoped to one project, so two matches means the same
  // key exists twice and picking one would be a coin flip on who gets the flag.
  if (matches.length > 1) {
    throw new Error(
      `${matches.length} flags share the key "${key}" (ids: ${matches
        .map((flag) => flag.id)
        .join(', ')}). Pass a key scoped to one project.`,
    )
  }
  return matches[0]
}

// ── Account verification ─────────────────────────────────────────────────────

const findMissingAccounts = async (emails: string[]): Promise<string[]> => {
  const prisma = new PrismaClient()
  try {
    const users = await prisma.user.findMany({
      where: { email: { in: emails, mode: 'insensitive' } },
      select: { email: true },
    })
    const found = new Set(
      users.map((user) => user.email?.toLowerCase()).filter(Boolean),
    )
    return emails.filter((email) => !found.has(email))
  } finally {
    await prisma.$disconnect()
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2))
  const apiKey = process.env.AMPLITUDE_MANAGEMENT_API_KEY
  if (!apiKey) {
    throw new Error(
      'AMPLITUDE_MANAGEMENT_API_KEY is not set. Create one under Experiment > ' +
        'Management API in Amplitude; the deployment key will not work.',
    )
  }

  const { readFile } = await import('fs/promises')
  const emails = parseEmails(await readFile(args.emailsFile, 'utf8'))
  if (emails.length === 0) {
    throw new Error(`No addresses found in ${args.emailsFile}`)
  }
  console.log(`Read ${emails.length} address(es) from ${args.emailsFile}`)

  if (args.verifyAccounts) {
    const missing = await findMissingAccounts(emails)
    if (missing.length > 0) {
      console.log(`\n${missing.length} address(es) have no account:`)
      for (const email of missing) console.log(`  ${email}`)
      if (!args.allowUnknown) {
        throw new Error(
          'Refusing to write. A typo targets nobody and looks identical to a ' +
            'user who never signed up. Fix the list, or pass --allow-unknown.',
        )
      }
      console.log('  (--allow-unknown: continuing anyway)\n')
    } else {
      console.log('All addresses have accounts.')
    }
  }

  const flag = await findFlag(args.flag, apiKey)
  const segments = flag.targetSegments
  console.log(
    `Flag "${flag.key}" (id ${flag.id}) has ${segments.length} target segment(s)`,
  )

  const cohortSegment = findCohortSegment(segments)
  if (cohortSegment) {
    throw new Error(
      `Segment "${cohortSegment.name}" targets a cohort, which this API cannot ` +
        `round-trip — writing would delete it. Add the cohort in the Amplitude UI.`,
    )
  }

  const result = mergeCohortIntoSegments(segments, {
    segmentName: args.segment,
    variant: args.variant,
    emails,
  })

  console.log(
    result.createdSegment
      ? `\nWould create segment "${args.segment}" → ${args.variant}`
      : `\nWould update segment "${args.segment}"`,
  )
  console.log(`  adding ${result.added.length}:`)
  for (const email of result.added) console.log(`    + ${email}`)
  if (result.alreadyPresent.length > 0) {
    console.log(`  already present: ${result.alreadyPresent.length}`)
  }
  console.log(`  preserving ${segments.length} existing segment(s)`)

  if (!args.execute) {
    console.log('\nDry run. Re-run with --execute to apply.')
    return
  }

  if (result.added.length === 0) {
    console.log('\nNothing to add.')
    return
  }

  await request(`/flags/${flag.id}`, apiKey, {
    method: 'PATCH',
    body: JSON.stringify({ targetSegments: result.segments }),
  })
  console.log(`\nApplied. ${result.added.length} address(es) added.`)
}

if (process.argv[1]?.includes('amplitude-flag-cohort')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
