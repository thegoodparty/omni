import { Injectable, OnModuleDestroy, StreamableFile } from '@nestjs/common'
import { Pool } from 'pg'
import { to as copyTo } from 'pg-copy-streams'
import { buffer as streamToBuffer } from 'node:stream/consumers'
import { stripLeadingNewlines } from '../utils/polls.utils'
import { PinoLogger } from 'nestjs-pino'
import { requireEnv } from 'src/shared/util/env.util'

const UTF8_BOM = '\uFEFF'

@Injectable()
export class PollResponsesDownloadService implements OnModuleDestroy {
  private readonly pool: Pool

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(PollResponsesDownloadService.name)
    // Read DATABASE_URL at construction time (not module-import time) so test
    // harnesses that swap `process.env.DATABASE_URL` after the file is loaded
    // — e.g. `useTestService()` pointing at a testcontainers Postgres — see
    // the correct value.
    this.pool = new Pool({
      connectionString: requireEnv('DATABASE_URL'),
      // Preview shares one 0.5-ACU Aurora instance across every PR stack; cap
      // the pool so 25+ previews don't exhaust it (pg defaults to max 10).
      max: process.env.IS_PREVIEW === 'true' ? 5 : undefined,
    })
  }

  onModuleDestroy() {
    this.pool.end()
  }

  async buildPollResponsesCsv(
    pollId: string,
    pollName: string,
    fileName: string,
  ): Promise<StreamableFile> {
    const client = await this.pool.connect()

    try {
      const escapedPollId = client.escapeLiteral(pollId)
      // Neutralize CSV/spreadsheet formula injection: a constituent reply
      // stored verbatim in pim.content can begin with =, +, -, or @, which
      // Excel/Sheets execute as a formula on the staff machine that opens the
      // export. Prefix a single quote so the cell is forced to text.
      // associated_clusters is system-generated poll-issue titles (not
      // constituent input), so it is left as-is.
      const sql = `COPY (
        SELECT
          CASE
            WHEN left(pim.content, 1) = ANY (ARRAY['=', '+', '-', '@'])
            THEN '''' || pim.content
            ELSE pim.content
          END AS message_content,
          COALESCE(
            (
              SELECT string_agg(DISTINCT pi.title, '; ' ORDER BY pi.title)
              FROM "_PollIndividualMessageToPollIssue" j
              JOIN poll_issues pi ON pi.id = j."B"
              WHERE j."A" = pim.id
            ),
            ''
          ) AS associated_clusters
        FROM poll_individual_message pim
        WHERE pim.poll_id = ${escapedPollId}
          AND pim.sender = 'CONSTITUENT'
          AND (pim.is_opt_out IS NULL OR pim.is_opt_out = false)
        ORDER BY pim.sent_at
      ) TO STDOUT WITH (FORMAT CSV, HEADER TRUE)`

      const cleanPollName =
        pollName.replace(/[\r\n]/g, ' ').trim() || 'Poll responses'
      // Same formula-injection guard as message_content: the poll name is
      // user-supplied (paid-poll purchase metadata) and is written as cell A1
      // of the export, so a name starting with =, +, -, or @ would execute
      // when staff open the file.
      const safePollName = /^[=+\-@]/.test(cleanPollName)
        ? `'${cleanPollName}`
        : cleanPollName

      // Buffer the whole CSV and return it with a Content-Length rather than
      // streaming it chunked. A poll export is small, and a chunked response
      // was being truncated mid-body in transit as it passed through the
      // Vercel edge rewrite. A fixed-length body has nothing to sever.
      const copyStream = client.query(copyTo(sql))
      const stripped = copyStream.pipe(stripLeadingNewlines())
      // `pipe` does not forward source errors, so a mid-COPY pg failure would
      // hang the consumer below instead of rejecting. Forward it explicitly.
      copyStream.on('error', (err) => stripped.destroy(err))

      const header = Buffer.from(UTF8_BOM + safePollName + '\n')
      const body = Buffer.concat([header, await streamToBuffer(stripped)])

      client.release()
      return new StreamableFile(body, {
        type: 'text/csv; charset=utf-8',
        disposition: `attachment; filename="${fileName}.csv"`,
        length: body.length,
      })
    } catch (err) {
      this.logger.error(err, 'COPY stream error')
      // Release with the error so pg-pool discards a connection that may still
      // be stuck in COPY protocol mode rather than handing it back to the pool.
      client.release(err instanceof Error ? err : true)
      throw err
    }
  }
}
