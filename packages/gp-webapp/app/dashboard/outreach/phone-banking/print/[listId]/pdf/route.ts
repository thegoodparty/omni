import { FetchError } from 'ofetch'
import JSZip from 'jszip'
import type { PhoneBankingList } from '@goodparty_org/contracts'
import candidateAccess from 'app/dashboard/shared/candidateAccess'
import { serverRequest } from 'gpApi/server-request'
import { renderCallSheetPdf } from '../../pdf/CallSheetPdf'
import {
  callSheetFilename,
  callSheetRows,
  callSheetZipFilename,
  sheetIndexesOf,
  type CallSheetRow,
} from '../../pdf/callSheetRows'

export const dynamic = 'force-dynamic'
// @react-pdf/renderer lays out through yoga and writes the file with pdfkit,
// and jszip buffers the archive in memory — none of that runs on the edge
// runtime.
export const runtime = 'nodejs'
// A multi-sheet request renders every sheet before it can zip them, so this
// scales with sheet count rather than any single sheet's own cost. The
// default 15s is close enough to a large list's worst case to be worth
// raising, same as the walk-list PDF route.
export const maxDuration = 60

const notFound = () => new Response('Not found', { status: 404 })

const fetchList = async (listId: string): Promise<PhoneBankingList | null> => {
  try {
    const response = await serverRequest('GET /v1/phone-banking/lists/:id', {
      id: listId,
    })
    return response.data
  } catch (error) {
    // gp-api 404s a list that isn't yours, doesn't exist, or was deleted —
    // there's nothing useful to say about any of them. Anything else (a 500,
    // a timeout) is a different problem and should surface, not be read as
    // "no such list".
    if (error instanceof FetchError && error.status === 404) return null
    throw error
  }
}

const pdfResponse = (filename: string, pdf: Buffer): Response =>
  new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      // A call sheet is voter data and goes stale the moment a call is logged.
      'Cache-Control': 'no-store',
    },
  })

// This is the PDF's only source of names, phones, and call outcomes — the
// deliberate privacy reversal from door knocking (phone numbers print here on
// purpose) makes an unauthenticated share endpoint a non-starter, so there is
// only ever this authenticated route.
export const GET = async (
  request: Request,
  { params }: { params: Promise<{ listId: string }> },
): Promise<Response> => {
  await candidateAccess()

  const { listId } = await params
  // gp-api parses this param with ParseIntPipe, which 400s rather than 404s
  // on a non-numeric id — a hand-mangled URL is "no such list" to whoever
  // typed it, and there's no reason to ask the API about it at all.
  if (!/^\d+$/.test(listId)) return notFound()

  const list = await fetchList(listId)
  if (!list) return notFound()

  const rows = callSheetRows(list.entries)
  const sheets = sheetIndexesOf(rows)
  const sheetTotal = Math.max(sheets.length, 1)

  const rowsForSheet = (sheetIndex: number): CallSheetRow[] =>
    rows.filter((row) => row.sheetIndex === sheetIndex)

  const renderSheet = (sheetIndex: number): Promise<Buffer> =>
    renderCallSheetPdf({
      listName: list.name,
      script: list.script,
      sheetIndex,
      sheetCount: sheetTotal,
      rows: rowsForSheet(sheetIndex),
    })

  const sheetParam = new URL(request.url).searchParams.get('sheet')
  if (sheetParam !== null) {
    const sheetIndex = Number(sheetParam)
    if (!sheets.includes(sheetIndex)) return notFound()
    const pdf = await renderSheet(sheetIndex)
    return pdfResponse(
      callSheetFilename(list.name, sheetIndex, sheetTotal),
      pdf,
    )
  }

  const [onlySheet] = sheets
  if (sheets.length <= 1) {
    const sheetIndex = onlySheet ?? 1
    const pdf = await renderSheet(sheetIndex)
    return pdfResponse(
      callSheetFilename(list.name, sheetIndex, sheetTotal),
      pdf,
    )
  }

  const zip = new JSZip()
  for (const sheetIndex of sheets) {
    const pdf = await renderSheet(sheetIndex)
    zip.file(callSheetFilename(list.name, sheetIndex, sheetTotal), pdf)
  }
  const archive = await zip.generateAsync({ type: 'nodebuffer' })

  return new Response(new Uint8Array(archive), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${callSheetZipFilename(list.name)}"`,
      'Cache-Control': 'no-store',
    },
  })
}
