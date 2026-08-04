import 'dotenv/config'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaClient, ExperimentRunStatus } from '../src/generated/prisma'
import { createClerkClient } from '@clerk/backend'
import { isInactiveUser } from '../src/shared/util/userActivity.util'

// dispatchManual (behind /v1/meetings/briefings/dispatch) has no activity gate
// of its own — only dispatchBriefingIfNeeded (the cron path) checks this. Until
// that gap is closed server-side, replicate the same 30-day check here so a
// manual run doesn't dispatch to offices the cron would skip.

const BRIEFING_COST_USD = 3.9
const TOKEN_TTL_SECONDS = 3600
const DEFAULT_TARGET = 100
const DEFAULT_MAX_IN_FLIGHT = 100
const IN_FLIGHT_POLL_MS = 30_000

type DispatchRecord = {
  electedOfficeId: string
  organizationSlug: string
  httpStatus: number
  dispatched: boolean
  ok: boolean
  ts: string
}

const requireEnv = (name: string): string => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

const mintToken = async (): Promise<string> => {
  const clerk = createClerkClient({
    secretKey: requireEnv('CLERK_SECRET_KEY'),
    publishableKey: requireEnv('CLERK_PUBLISHABLE_KEY'),
  })
  // Mint with the caller machine secret (gp-admin's GP_PROD_MACHINE_SECRET),
  // not gp-api's GP_API_MACHINE_SECRET. gp-api verifies as the recipient,
  // so the token must be issued by a machine connected to it in Clerk.
  const minted = await clerk.m2m.createToken({
    machineSecretKey: requireEnv('GP_PROD_MACHINE_SECRET'),
    secondsUntilExpiration: TOKEN_TTL_SECONDS,
  })
  if (!minted.token) throw new Error('Clerk did not return an m2m token')
  return minted.token
}

const confirm = async (message: string): Promise<boolean> => {
  const rl = createInterface({ input: stdin, output: stdout })
  const answer = await rl.question(message)
  rl.close()
  return answer.trim().toLowerCase() === 'y'
}

// Fisher-Yates shuffle for a fair random sample of eligible offices.
const shuffle = <T>(items: T[]): T[] => {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

type Office = { id: string; organizationSlug: string }

async function main() {
  const apiUrl = process.env.PROD_API_URL ?? 'https://api.goodparty.org'
  const databaseUrl = requireEnv('PROD_DATABASE_URL')
  const concurrency = Number(process.env.CONCURRENCY ?? '5')
  const dryRun = process.argv.includes('--dry-run')
  const targetArg = process.argv.find((a) => a.startsWith('--target='))
  const target = targetArg ? Number(targetArg.split('=')[1]) : DEFAULT_TARGET
  const maxInFlightArg = process.argv.find((a) =>
    a.startsWith('--max-in-flight='),
  )
  const maxInFlight = maxInFlightArg
    ? Number(maxInFlightArg.split('=')[1])
    : DEFAULT_MAX_IN_FLIGHT

  const prisma = new PrismaClient({ datasourceUrl: databaseUrl })
  const allOffices = await prisma.electedOffice.findMany({
    select: {
      id: true,
      organizationSlug: true,
      user: { select: { metaData: true } },
    },
  })

  const now = new Date()
  const activeOffices = allOffices.filter(
    (o) => !isInactiveUser(o.user?.metaData?.lastVisited, now),
  )
  const skippedInactive = allOffices.length - activeOffices.length

  const pool = shuffle(
    activeOffices.map((o) => ({
      id: o.id,
      organizationSlug: o.organizationSlug,
    })),
  )
  const maxEstimate = target * BRIEFING_COST_USD

  if (dryRun) {
    console.log(
      [
        'DRY RUN — no token minted, no dispatches sent.',
        `Target:          ${apiUrl}`,
        `Prod offices:    ${allOffices.length} total`,
        `Local activity gate: ${skippedInactive} skipped (30+ day inactive)`,
        `Eligible pool:   ${pool.length} (shuffled)`,
        `Goal:            ${target} briefings actually dispatched`,
        `Gate:            useImminenceGate=true (serve-ICP + 3-day window + dedupe)`,
        `Concurrency:     ${concurrency}`,
        `Max in-flight:   ${maxInFlight} agents running at once`,
        `Max est. cost:   ~$${maxEstimate.toFixed(2)} (at the target)`,
        '',
        'The endpoint self-filters: offices that are not serve-ICP, have no',
        'meeting in the next 3 days, or are already covered by a future',
        'briefing return dispatched:false and cost nothing. We walk the',
        'shuffled pool until the target is reached, pausing dispatch whenever',
        `${maxInFlight} meeting_briefing agents are already active`,
        '(RUNNING or AWAITING_RESUME).',
        '',
        'Sample order:',
        ...pool.slice(0, 10).map((o) => `  ${o.id}  ${o.organizationSlug}`),
      ].join('\n'),
    )
    await prisma.$disconnect()
    return
  }

  const proceed = await confirm(
    [
      `Target:        ${apiUrl}`,
      `Prod offices:  ${allOffices.length} total`,
      `Skipped:       ${skippedInactive} (30+ day inactive)`,
      `Eligible pool: ${pool.length} (shuffled)`,
      `Goal:          ${target} briefings dispatched (serve-ICP + 3-day gate)`,
      `Concurrency:   ${concurrency}`,
      `Max in-flight: ${maxInFlight} agents running at once`,
      `Max est. cost: ~$${maxEstimate.toFixed(2)} (hard cap at the target)`,
      '',
      'Proceed? (y/N) ',
    ].join('\n'),
  )
  if (!proceed) {
    console.log('Aborted.')
    await prisma.$disconnect()
    return
  }

  mkdirSync(join(__dirname, 'output'), { recursive: true })
  const logPath = join(
    __dirname,
    'output',
    `dispatch-imminent-briefings.${new Date().toISOString()}.jsonl`,
  )

  // Throttled runs wait on agent completions (~15 min each) and can outlast
  // a single token TTL, so re-mint when the current one nears expiry.
  let token = await mintToken()
  let tokenMintedAt = Date.now()
  let tokenRefresh: Promise<void> | null = null
  const freshToken = async (): Promise<string> => {
    if (Date.now() - tokenMintedAt > (TOKEN_TTL_SECONDS - 600) * 1000) {
      if (!tokenRefresh) {
        tokenRefresh = mintToken()
          .then((minted) => {
            token = minted
            tokenMintedAt = Date.now()
          })
          .catch(() => {
            // On mint failure, reset the window so workers don't tight-loop
            // against Clerk — the next attempt is allowed after ~60s.
            tokenMintedAt = Date.now() - (TOKEN_TTL_SECONDS - 660) * 1000
          })
          .finally(() => {
            tokenRefresh = null
          })
      }
      await tokenRefresh
    }
    return token
  }

  const records: DispatchRecord[] = []
  let dispatched = 0
  // Slots claimed by in-flight or completed dispatches. Workers claim a slot
  // synchronously before each call so the concurrent pool can never push
  // `dispatched` past `target` and blow the cost cap. A skip releases its slot.
  let reserved = 0
  let index = 0

  // Fleet cap: never let more than maxInFlight meeting_briefing agents run at
  // once. dbRunning refreshes at most every IN_FLIGHT_POLL_MS; dispatches made
  // since the last refresh (dispatched - dispatchedAtCheck) plus in-flight
  // HTTP calls (reserved - dispatched) are stacked on top, so the estimate
  // only ever overcounts — it can pause early, never overshoot the cap.
  let dbRunning = 0
  let dispatchedAtCheck = 0
  let lastInFlightCheckAt = 0
  const refreshInFlight = async (): Promise<void> => {
    if (Date.now() - lastInFlightCheckAt < IN_FLIGHT_POLL_MS) return
    lastInFlightCheckAt = Date.now()
    // Snapshot before the query: dispatches landing while the count runs are
    // then double-counted (in both dbRunning and the delta term), keeping the
    // estimate on the overcount side. Snapshotting after would drop them.
    const dispatchedBeforeQuery = dispatched
    dbRunning = await prisma.experimentRun.count({
      where: {
        experimentType: 'meeting_briefing',
        status: {
          in: [
            ExperimentRunStatus.RUNNING,
            ExperimentRunStatus.AWAITING_RESUME,
          ],
        },
      },
    })
    dispatchedAtCheck = dispatchedBeforeQuery
    if (dbRunning >= maxInFlight) {
      console.log(
        `  throttled: ${dbRunning} agents active >= ${maxInFlight} cap`,
      )
    }
  }
  await refreshInFlight()

  const callDispatch = async (office: Office): Promise<boolean> => {
    let httpStatus = 0
    let didDispatch = false
    try {
      const res = await fetch(`${apiUrl}/v1/meetings/briefings/dispatch`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${await freshToken()}`,
        },
        body: JSON.stringify({
          electedOfficeId: office.id,
          kind: 'briefing',
          useImminenceGate: true,
        }),
      })
      httpStatus = res.status
      if (res.ok) {
        const body: unknown = await res.json()
        didDispatch =
          typeof body === 'object' &&
          body !== null &&
          'dispatched' in body &&
          body.dispatched === true
      }
    } catch {
      httpStatus = 0
    }
    const record: DispatchRecord = {
      electedOfficeId: office.id,
      organizationSlug: office.organizationSlug,
      httpStatus,
      dispatched: didDispatch,
      ok: httpStatus >= 200 && httpStatus < 300,
      ts: new Date().toISOString(),
    }
    records.push(record)
    appendFileSync(logPath, `${JSON.stringify(record)}\n`)
    return didDispatch
  }

  const runStart = new Date().toISOString()
  const workers = Array.from(
    { length: Math.min(concurrency, pool.length) },
    () =>
      (async () => {
        while (dispatched < target && index < pool.length) {
          // Claim a slot synchronously — no await between the checks and the
          // increment — so two workers can never both take the last one, and
          // the in-flight estimate can never be raced past the cap.
          if (reserved >= target) {
            await new Promise((resolve) => setTimeout(resolve, 25))
            continue
          }
          if (
            dbRunning + Math.max(reserved - dispatchedAtCheck, 0) >=
            maxInFlight
          ) {
            await refreshInFlight()
            await new Promise((resolve) => setTimeout(resolve, 5000))
            continue
          }
          reserved++
          const did = await callDispatch(pool[index++])
          if (did) {
            dispatched++
            if (dispatched % 10 === 0) {
              console.log(`  dispatched ${dispatched}/${target}`)
            }
          } else {
            // A skip consumed no briefing; free the slot for another office.
            reserved--
          }
        }
      })(),
  )
  await Promise.all(workers)
  const runEnd = new Date().toISOString()
  await prisma.$disconnect()

  const okCalls = records.filter((r) => r.ok).length
  const failures = records.filter((r) => !r.ok)

  console.log(
    JSON.stringify(
      {
        goal: target,
        skippedInactive,
        dispatched,
        callsMade: records.length,
        okCalls,
        skipped: okCalls - dispatched,
        failures: failures.map((r) => ({
          electedOfficeId: r.electedOfficeId,
          httpStatus: r.httpStatus,
        })),
        estCostUsd: Number((dispatched * BRIEFING_COST_USD).toFixed(2)),
        logPath,
        reconcile: { runStart, runEnd },
      },
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
