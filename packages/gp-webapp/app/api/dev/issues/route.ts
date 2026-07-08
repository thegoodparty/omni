import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'
import type { IssueArtifact } from '../../../dev/issues/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The canonical local issues directory. Overridable via LOCAL_ISSUES_DIR
// (absolute path — can point at a scratchpad subdir). Otherwise the omni repo
// root `.local-issues/`. Under `next dev`, cwd is packages/gp-webapp, so two
// levels up is the repo root. Issue artifacts deliberately never live under
// packages/gp-webapp/ so they can't ship to Vercel.
const issuesDir = (): string =>
  process.env.LOCAL_ISSUES_DIR ??
  path.resolve(process.cwd(), '../../.local-issues')

export const GET = async (): Promise<NextResponse> => {
  // Dev-only. Never ships behavior to Vercel dev/qa/prod.
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const dir = issuesDir()

  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()
  } catch {
    return NextResponse.json({ issues: [], dir })
  }

  const issues: { runId: string; artifact: IssueArtifact }[] = []
  for (const file of files) {
    try {
      const raw = await readFile(path.join(dir, file), 'utf8')
      issues.push({
        runId: file.replace(/\.json$/, ''),
        artifact: JSON.parse(raw) as IssueArtifact,
      })
    } catch {
      // Skip unreadable / malformed files rather than failing the whole gallery.
    }
  }

  return NextResponse.json({ issues, dir })
}
