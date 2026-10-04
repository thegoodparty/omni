import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import {
  type DbxStatementRecord,
  statementCollector,
} from './peopleDbxStatement.client'

// One log line per voter read, at a stable message so a Loki query can
// aggregate a week of them. Flat rather than nested because LogQL cannot
// unwrap nested json without a parser expression per field.
//
// statementBytes is how much SQL we sent, per statement. Id sets are inlined
// rather than bound, so two reads of the same route can differ by four orders
// of magnitude in planning cost with nothing else to tell them apart — a slow
// read is either a big statement or a slow warehouse, and until this field
// existed the line could not say which.
type VoterReadLog = {
  op: string
  districtId: string
  dbxMs: number
  statementIds: string[]
  statementBytes: number[]
}

export const VOTER_READ_MESSAGE = 'people-db voter read'

@Injectable()
export class VoterReadLogService {
  // PinoLogger, not @nestjs/common's Logger: only Pino's (object, message)
  // signature puts these fields at the top level of the log line, and being
  // able to aggregate them in LogQL is the whole point.
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(VoterReadLogService.name)
  }

  // Voter data has one store, so a warehouse failure propagates: it surfaces
  // as an error rather than a quietly degraded answer. The line is still
  // emitted on that path — a statement that timed out is exactly the sample a
  // cold-start attribution needs, and dropping it would bias the measurement
  // toward the reads that were already fast.
  async measure<T>(args: {
    op: string
    districtId: string
    read: () => Promise<T>
  }): Promise<T> {
    const startedAt = performance.now()
    // Collected per operation, not per statement: `list` issues a count and a
    // page, and an export issues a submit plus its chunk fetches.
    const statements: DbxStatementRecord[] = []
    try {
      const value = await statementCollector.run(statements, () => args.read())
      this.log(args, startedAt, statements)
      return value
    } catch (err) {
      this.log(args, startedAt, statements, err)
      throw err
    }
  }

  private log(
    args: { op: string; districtId: string },
    startedAt: number,
    statements: DbxStatementRecord[],
    err?: unknown,
  ): void {
    const entry: VoterReadLog = {
      op: args.op,
      districtId: args.districtId,
      dbxMs: Math.round(performance.now() - startedAt),
      statementIds: statements.map((statement) => statement.id),
      statementBytes: statements.map((statement) => statement.bytes),
    }
    if (err === undefined) {
      this.logger.info(entry, VOTER_READ_MESSAGE)
      return
    }
    this.logger.warn({ ...entry, err }, VOTER_READ_MESSAGE)
  }
}
