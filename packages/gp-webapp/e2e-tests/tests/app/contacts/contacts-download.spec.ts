import { createGunzip } from 'node:zlib'
import type { Readable } from 'node:stream'
import { expect, test } from '@playwright/test'
import { blockSlowScripts } from 'src/helpers/navigation.helper'
import {
  crmSheet,
  enableCrmFlags,
  gotoCrmContacts,
  listCard,
} from 'src/helpers/crm-contacts-e2e'
import { setupProCampaignUser } from 'src/helpers/organizations'

// The curated CSV contract: gp-api's DOWNLOAD_COLUMNS
// (src/peopleDb/voter.select.ts) projects 76 columns under friendly headers, in
// a fixed order that people's spreadsheet and mail-house import mappings are
// keyed on. Only the leading run is spelled out here — the count is what
// catches a dropped, duplicated, or silently reordered column.
const EXPECTED_COLUMN_COUNT = 76
const LEADING_HEADERS = [
  'Voter ID',
  'First Name',
  'Middle Name',
  'Last Name',
  'Suffix',
  'Registered Party',
  'Gender',
  'Age',
]

// Read enough of a CSV stream to see its header row and first data row, then
// stop pulling bytes (a district export is millions of characters).
const readCsvHead = async (stream: Readable): Promise<string> => {
  let buffered = ''
  for await (const chunk of stream) {
    buffered += Buffer.from(chunk).toString('utf8')
    if (buffered.split(/\r?\n/).length > 2) {
      stream.destroy()
      break
    }
  }
  return buffered
}

const csvHead = (csv: string): { columns: string[]; firstRow: string } => {
  const [headerLine = '', firstRow = ''] = csv.split(/\r?\n/)
  return { columns: headerLine.split(','), firstRow }
}

const assertCuratedCsv = (csv: string): void => {
  const { columns, firstRow } = csvHead(csv)
  expect(columns.slice(0, LEADING_HEADERS.length)).toEqual(LEADING_HEADERS)
  expect(columns).toHaveLength(EXPECTED_COLUMN_COUNT)
  // A 76-field CSV row carries at least 75 separators (more when a field quotes
  // its own comma), so this asserts a real, fully-projected data row rather
  // than a header-only file.
  expect(firstRow.split(',').length).toBeGreaterThanOrEqual(
    EXPECTED_COLUMN_COUNT,
  )
}

// The contacts CSV export, end to end: the browser's own download of the whole
// voter universe, plus the wire contract gp-api commits to for it.
// Deliberately stronger than the shallow "a .csv download started" step inside
// win-contacts.spec.ts — this is the regression net for swapping the voter
// engine underneath the export (people-db Postgres COPY -> Databricks), where
// the failure modes are a changed column set, a lost gzip/streaming contract,
// or an empty file, none of which a filename assertion catches.
//
// Not @dev-only: a per-PR preview's gp-api runs on the GP_API_DEV secret, so it
// serves the same real district voter data as dev, and setupProCampaignUser
// provisions Pro without the Stripe webhook. See e2e-tests/CLAUDE.md.
test.describe('Contacts CSV download', () => {
  test.beforeEach(async ({ page }) => {
    await blockSlowScripts(page)
    await enableCrmFlags(page)
  })

  test('streams the curated gzipped CSV for the whole voter universe', async ({
    page,
  }) => {
    test.setTimeout(5 * 60 * 1000)

    const { client } = await setupProCampaignUser(page)

    await gotoCrmContacts(page)

    const universeCard = listCard(page, 'All voters')
    await expect(universeCard).toBeVisible({ timeout: 20_000 })
    await universeCard.getByRole('button', { name: 'Details' }).click()

    const detailSheet = crmSheet(page)
    await expect(detailSheet).toBeVisible({ timeout: 15_000 })

    // The universe sheet's footer download (ENG-10809) is an <a download>
    // top-level navigation, so the browser's download machinery consumes the
    // response — the download event is the correct primitive, and the file it
    // hands back is the gzip-decoded CSV the user actually opens.
    const downloadPromise = page.waitForEvent('download', { timeout: 120_000 })
    await detailSheet.getByRole('button', { name: 'Download list' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/\.csv$/)
    assertCuratedCsv(await readCsvHead(await download.createReadStream()))

    // The wire contract the browser download can't expose: gp-api flushes
    // these headers before the first body byte so the download starts while
    // COPY is still planning (voterDownload.service.ts). responseType 'stream'
    // resolves on the response event, so they are asserted before any body
    // byte is drained; decompress: false keeps the gzip framing intact instead
    // of letting the client transparently inflate it.
    const response = await client.get<Readable>('/v1/contacts/download', {
      responseType: 'stream',
      decompress: false,
      headers: { 'Accept-Encoding': 'gzip' },
      timeout: 120_000,
    })
    expect(String(response.headers['content-type'])).toContain('text/csv')
    expect(String(response.headers['content-encoding'])).toBe('gzip')
    expect(String(response.headers['content-disposition'])).toMatch(
      /^attachment;\s*filename="contacts\.csv"$/,
    )

    // Inflate as it arrives and stop at the first data row. Buffering the whole
    // body first would mean holding a district-sized export in memory.
    assertCuratedCsv(await readCsvHead(response.data.pipe(createGunzip())))
  })
})
