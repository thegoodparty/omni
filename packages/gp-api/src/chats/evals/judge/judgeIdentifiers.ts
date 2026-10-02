import { appendFileSync } from 'node:fs'
import { RaceListItemArraySchema } from '@goodparty_org/contracts'
import { Headers, MimeTypes } from 'http-constants-ts'
import { JUDGE_ORG_SLUG_PREFIX } from './runners/background'
import { JUDGE_FIXTURE_RACE } from './sweepFixture'

// THE THREE VALUES SIX BACKGROUND CASE LISTS CANNOT CARRY, made up per sweep.
//
// None of them is a live lookup by the agent (see sweepFixture.ts): the
// organization slug is echoed into the artifact and, because the dispatch pins
// it to `judge-*`, names an organization that does not exist; `race_id` is a
// trace and idempotency identifier; `user_email` is matched only against a
// roster inside the same params. So none of them has to name anything that
// exists, and nothing here needs a credential.
//
// Resolved once per sweep, by a step before either arm, and handed to both
// through step outputs: two arms with different values would be comparing two
// inputs.

// Not a person and not a mailbox anyone reads: example.com is reserved for
// exactly this (RFC 2606), and a public case list should carry no real address.
export const JUDGE_USER_EMAIL = 'judge-sweep@example.com'

// The dispatch's own pattern and prefix, so a slug this writes is one the
// dispatch accepts.
const ORG_SLUG = /^[a-zA-Z0-9_-]{1,64}$/

// One per sweep, from the sweep id both arms already share. The organization
// does not exist, so the slug only has to be one nothing real uses; an eval
// run writes no `latest.json` under it, so nothing carries between runs.
export const judgeOrgSlug = (sweepId: string): string => {
  const slug = `${JUDGE_ORG_SLUG_PREFIX}${sweepId.replace(/^judge-/, '')}`
  if (!ORG_SLUG.test(slug)) {
    throw new Error(
      `sweep id ${JSON.stringify(sweepId)} does not make a dispatchable ` +
        'organization slug',
    )
  }
  return slug
}

// Dev or a local gp-api only, the judge's environment at every other layer.
// The race lookup is public, so nothing is sent but the zip; the allowlist is
// about not reading a race id from somewhere nobody checked.
const ALLOWED_API =
  /^(https:\/\/gp-api-dev\.goodparty\.org|http:\/\/localhost:\d+)$/

export const requireAllowedApi = (apiUrl: string | undefined): string => {
  if (apiUrl === undefined || !ALLOWED_API.test(apiUrl)) {
    throw new Error(
      `JUDGE_FIXTURE_API_URL is ${JSON.stringify(apiUrl ?? null)}; the judge ` +
        'reads its race from the dev gp-api or a local one only',
    )
  }
  return apiUrl
}

const RACES_BY_YEAR_PATH = '/v1/elections/races-by-year'

// The BallotReady id of the race the case lists name, read from gp-api's
// public races route (`@PublicAccess()`, no credential). A real id rather than
// a constant, because the field is documented as one.
export const resolveRaceId = async (
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> => {
  const url = new URL(RACES_BY_YEAR_PATH, baseUrl)
  url.searchParams.set('zipcode', JUDGE_FIXTURE_RACE.zip)
  const response = await fetchImpl(url, {
    headers: { [Headers.ACCEPT]: MimeTypes.APPLICATION_JSON },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    throw new Error(`GET ${RACES_BY_YEAR_PATH} answered ${response.status}`)
  }
  const match = RaceListItemArraySchema.parse(await response.json()).find(
    (race) => race.position.name === JUDGE_FIXTURE_RACE.office,
  )
  if (match === undefined) {
    throw new Error(
      `no race named "${JUDGE_FIXTURE_RACE.office}" for zip ` +
        `${JUDGE_FIXTURE_RACE.zip}, so the race_id agents have no value`,
    )
  }
  return match.id
}

// What a sweep has to hand both arms. The race id alone can be missing: the
// slug and the address are made here, but the race is read from dev data,
// and the races route lists upcoming races only, so it goes missing as soon
// as that election has passed.
export interface ResolvedIdentifiers {
  orgSlug: string
  userEmail: string
  raceId?: string
  // Why there is no race id, for the run log.
  raceUnavailable?: string
}

// AT MOST THREE LINES for $GITHUB_OUTPUT, and no race_id when there is none:
// an absent output reads as unset on the arms, so only the three agents that
// need a race are refused, by name, and the rest still run. A value with a
// line break is refused: in that file it would end its own line and start an
// output of its choosing.
export const identifierOutputLines = (ids: ResolvedIdentifiers): string => {
  const values = {
    org_slug: ids.orgSlug,
    ...(ids.raceId !== undefined && { race_id: ids.raceId }),
    user_email: ids.userEmail,
  }
  for (const [key, value] of Object.entries(values)) {
    if (/[\r\n]/.test(value)) {
      throw new Error(`the judge's ${key} contains a line break`)
    }
  }
  return Object.entries(values)
    .map(([key, value]) => `${key}=${value}\n`)
    .join('')
}

export const resolveJudgeIdentifiers = async (
  sweepId: string,
  apiUrl: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<ResolvedIdentifiers> => {
  const orgSlug = judgeOrgSlug(sweepId)
  const baseUrl = requireAllowedApi(apiUrl)
  try {
    return {
      orgSlug,
      userEmail: JUDGE_USER_EMAIL,
      raceId: await resolveRaceId(baseUrl, fetchImpl),
    }
  } catch (err) {
    return {
      orgSlug,
      userEmail: JUDGE_USER_EMAIL,
      raceUnavailable: err instanceof Error ? err.message : String(err),
    }
  }
}

// gp-api is CommonJS, so `require.main` is the house pattern.
//
//   JUDGE_SWEEP_ID=... JUDGE_FIXTURE_API_URL=... judgeIdentifiers.ts <out>
//
// Appends the outputs to <out>. A race it cannot read is a warning, not a
// failure: the outputs go without race_id. Exits non-zero with one sentence
// otherwise; judge.yml decides that a failure refuses the background agents
// and not the sweep.
if (require.main === module) {
  const [out] = process.argv.slice(2)
  const sweepId = process.env.JUDGE_SWEEP_ID
  const run = async (): Promise<void> => {
    if (!out || !sweepId) {
      throw new Error(
        'usage: JUDGE_SWEEP_ID=<id> JUDGE_FIXTURE_API_URL=<url> ' +
          'judgeIdentifiers.ts <path to append outputs to>',
      )
    }
    const ids = await resolveJudgeIdentifiers(
      sweepId,
      process.env.JUDGE_FIXTURE_API_URL,
    )
    appendFileSync(out, identifierOutputLines(ids))
    if (ids.raceUnavailable !== undefined) {
      // stdout, because that is where Actions reads workflow commands.
      process.stdout.write(
        `::warning::no race id for this sweep (${ids.raceUnavailable}), so ` +
          'the three background agents that need one are refused by name; ' +
          'the rest run\n',
      )
    }
    process.stderr.write(
      `background agents run as ${ids.orgSlug}, race ` +
        `${ids.raceId ?? 'none'}\n`,
    )
  }
  run().catch((err: unknown) => {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(1)
  })
}
