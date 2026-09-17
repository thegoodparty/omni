import candidateAccess from 'app/dashboard/shared/candidateAccess'
import { renderWalkListPdf } from '../../pdf/WalkListPdf'
import { walkListFilename } from '../../pdf/walkListRows'
import { fetchRoute, fetchTurfName } from '../../walkListData'

export const dynamic = 'force-dynamic'
// @react-pdf/renderer lays out through yoga and writes the file with pdfkit;
// neither runs on the edge runtime.
export const runtime = 'nodejs'
// Laying out the grid is CPU-bound and scales with residents, not stops. A
// route at the 150-stop cap measured ~4s and 11 pages locally, and a route
// where every door holds two targets is roughly double that. Well inside this
// ceiling, but the default 15s is close enough to the worst case to be worth
// raising for a download someone is waiting on.
export const maxDuration = 60

const notFound = () => new Response('Not found', { status: 404 })

// The PDF is built here rather than in the browser, and that is the whole
// design of this feature. `print/` exists for a canvasser on one bar of signal:
// generating the file client-side would mean shipping @react-pdf/renderer — a
// megabyte of layout engine and PDF writer — down the exact connection the
// offline story is built to work around, and adding the first `'use client'`
// module to a directory deliberately kept at zero. Rendering server-side keeps
// the library in the server bundle, where it costs nothing to download, and
// leaves every entry point a plain `<a href download>` that works with
// JavaScript off.
export const GET = async (
  _request: Request,
  { params }: { params: Promise<{ turfId: string }> },
): Promise<Response> => {
  await candidateAccess()

  const { turfId } = await params
  // gp-api parses this param with ParseIntPipe, which 400s rather than 404s on
  // a non-numeric id. A hand-mangled URL is "no such walk list" to the person
  // who typed it, and there's no reason to ask the API about it at all.
  if (!/^\d+$/.test(turfId)) return notFound()

  const [payload, turfName] = await Promise.all([
    fetchRoute(turfId),
    fetchTurfName(turfId),
  ])
  if (!payload) return notFound()

  const pdf = await renderWalkListPdf({ turfName, payload })

  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${walkListFilename(turfName)}"`,
      // A walk list is voter data and goes stale the moment a door is logged.
      'Cache-Control': 'no-store',
    },
  })
}
