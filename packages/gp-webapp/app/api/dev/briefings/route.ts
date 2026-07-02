import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'
import type { MeetingBriefingFull } from 'gpApi/generated/agent-job-contracts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The canonical local briefings directory. Overridable via LOCAL_BRIEFINGS_DIR
// (absolute path — can point at a scratchpad subdir). Otherwise the omni repo
// root `.local-briefings/`. Under `next dev`, cwd is packages/gp-webapp, so two
// levels up is the repo root. Briefing artifacts deliberately never live under
// packages/gp-webapp/ so they can't ship to Vercel.
const briefingsDir = (): string =>
  process.env.LOCAL_BRIEFINGS_DIR ??
  path.resolve(process.cwd(), '../../.local-briefings')

export const GET = async (): Promise<NextResponse> => {
  // Dev-only. Never ships behavior to Vercel dev/qa/prod.
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const dir = briefingsDir()

  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()
  } catch {
    return NextResponse.json({ briefings: [], dir })
  }

  const briefings: { slug: string; artifact: MeetingBriefingFull }[] = []
  for (const file of files) {
    try {
      const raw = await readFile(path.join(dir, file), 'utf8')
      briefings.push({
        slug: file.replace(/\.json$/, ''),
        artifact: JSON.parse(raw) as MeetingBriefingFull,
      })
    } catch {
      // Skip unreadable / malformed files rather than failing the whole gallery.
    }
  }

  return NextResponse.json({ briefings, dir })
}
