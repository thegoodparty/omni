import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { parseAgentRun } from '../../../../dev/shared/agent-run'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Same local dirs as the briefings and issues galleries (LOCAL_BRIEFINGS_DIR /
// LOCAL_ISSUES_DIR, else repo-root .local-briefings/ and .local-issues/). Each
// run's logs are pulled alongside its artifact as <runId>.session.jsonl and
// <runId>.milestones.jsonl by pull-local-briefings.sh / pull-local-issues.sh.
const runDirs = (): string[] => [
  process.env.LOCAL_BRIEFINGS_DIR ??
    path.resolve(process.cwd(), '../../.local-briefings'),
  process.env.LOCAL_ISSUES_DIR ??
    path.resolve(process.cwd(), '../../.local-issues'),
]

// session.jsonl can be ~1MB. Parsing here (not on the client) means we ship the
// small typed structure over the wire, never the raw log.
export const GET = async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> => {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { id } = await params
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    return NextResponse.json({ error: 'Invalid run id' }, { status: 400 })
  }

  const dirs = runDirs()

  let sessionText: string | null = null
  let dir: string | null = null
  for (const d of dirs) {
    try {
      sessionText = await readFile(path.join(d, `${id}.session.jsonl`), 'utf8')
      dir = d
      break
    } catch {
      // Not in this dir — try the next gallery's dir.
    }
  }
  if (sessionText === null || dir === null) {
    return NextResponse.json(
      { error: `No session.jsonl for run ${id}`, dirs },
      { status: 404 },
    )
  }

  let milestonesText = ''
  try {
    milestonesText = await readFile(
      path.join(dir, `${id}.milestones.jsonl`),
      'utf8',
    )
  } catch {
    // Milestones are optional — some runs never emit them.
  }

  const run = parseAgentRun(sessionText, milestonesText)
  return NextResponse.json({ run, id })
}
