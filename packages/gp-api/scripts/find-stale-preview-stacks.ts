import { execSync } from 'child_process'
import { isBefore, parseISO, subDays } from 'date-fns'
import { writeFileSync } from 'fs'
import { z } from 'zod'

const pulumiStacksSchema = z.array(z.object({ name: z.string() }))

const openPrsSchema = z.array(
  z.object({ number: z.number(), updated_at: z.string() }),
)

export type OpenPr = z.infer<typeof openPrsSchema>[number]

type FetchFn = (url: string, init: RequestInit) => Promise<Response>

const PER_PAGE = 100
const DEFAULT_IDLE_DAYS = 21

const getPreviewPulumiStacks = () => {
  const output = execSync('pulumi stack ls --json', {
    encoding: 'utf-8',
    stdio: 'pipe',
    cwd: `${__dirname}/../deploy`,
  })
  return pulumiStacksSchema
    .parse(JSON.parse(output))
    .map((s) => s.name)
    .filter((name) => name.startsWith('gp-api-pr-'))
}

const extractPrNumber = (stackName: string) => {
  const match = stackName.match(/^gp-api-pr-(\d+)$/)
  if (!match?.[1]) {
    throw new Error(`Could not extract PR number from stack name: ${stackName}`)
  }
  return parseInt(match[1])
}

export const parseIdleDays = (raw: string | undefined) => {
  if (raw === undefined || raw.trim() === '') return DEFAULT_IDLE_DAYS
  const days = Number(raw)
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`PREVIEW_IDLE_DAYS must be a positive number, got: ${raw}`)
  }
  return days
}

export const selectStaleStacks = (
  stackNames: string[],
  openPrs: OpenPr[],
  now: Date,
  idleDays: number,
) => {
  const lastActivity = new Map(
    openPrs.map((pr) => [pr.number, parseISO(pr.updated_at)]),
  )
  const cutoff = subDays(now, idleDays)
  return stackNames.filter((stack) => {
    const updatedAt = lastActivity.get(extractPrNumber(stack))
    return updatedAt === undefined || isBefore(updatedAt, cutoff)
  })
}

// A PR missing from this list gets its preview destroyed, so every page is
// fetched and any page failure throws rather than returning a short list.
export const fetchAllOpenPrs = async (
  fetchFn: FetchFn,
  repo: string,
  token: string,
) => {
  const prs: OpenPr[] = []
  for (let page = 1; ; page++) {
    const response = await fetchFn(
      `https://api.github.com/repos/${repo}/pulls` +
        `?state=open&per_page=${PER_PAGE}&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
    )
    if (!response.ok) {
      throw new Error(
        `GitHub API error (page ${page}): ` +
          `${response.status} ${response.statusText}`,
      )
    }
    const pagePrs = openPrsSchema.parse(await response.json())
    prs.push(...pagePrs)
    if (pagePrs.length < PER_PAGE) return prs
  }
}

const main = async () => {
  const outfile = process.argv[2]
  if (!outfile) {
    throw new Error('Output file is required')
  }
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    throw new Error('GITHUB_TOKEN environment variable is required')
  }
  const idleDays = parseIdleDays(process.env.PREVIEW_IDLE_DAYS)

  const prStacks = getPreviewPulumiStacks()
  console.log(`Found ${prStacks.length} PR stacks`)

  if (prStacks.length === 0) {
    writeFileSync(outfile, JSON.stringify([]))
    return
  }

  // Preview stacks are tagged with the PR number of the repo the workflow runs
  // in (omni). GITHUB_REPOSITORY is set by Actions to owner/repo.
  const repo = process.env.GITHUB_REPOSITORY ?? 'thegoodparty/omni'
  const openPrs = await fetchAllOpenPrs(fetch, repo, token)
  console.log(`Found ${openPrs.length} open PRs`)

  const staleStacks = selectStaleStacks(prStacks, openPrs, new Date(), idleDays)

  console.log(`Stale stacks (PR not open, or idle over ${idleDays} days):`)
  console.log(staleStacks.join('\n'))

  writeFileSync(outfile, JSON.stringify(staleStacks))
}

if (require.main === module) {
  main().catch((error: Error) => {
    console.error('Error:', error.message)
    process.exit(1)
  })
}
