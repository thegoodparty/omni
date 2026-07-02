import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { parseAgentRun } from '../../../../dev/shared/agent-run'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Same local dir as the briefings gallery (LOCAL_BRIEFINGS_DIR, else repo-root
// .local-briefings/). Each run's logs are pulled alongside its artifact as
// <runId>.session.jsonl and <runId>.milestones.jsonl by pull-local-briefings.sh.
const briefingsDir = (): string =>
  process.env.LOCAL_BRIEFINGS_DIR ??
  path.resolve(process.cwd(), '../../.local-briefings')

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

  const dir = briefingsDir()

  let sessionText: string
  try {
    sessionText = await readFile(path.join(dir, `${id}.session.jsonl`), 'utf8')
  } catch {
    return NextResponse.json(
      { error: `No session.jsonl for run ${id}`, dir },
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
