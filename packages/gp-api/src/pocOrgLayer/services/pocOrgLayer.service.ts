import { randomUUID } from 'node:crypto'
import { BadRequestException, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { Organization } from '@/generated/prisma'
import { ContactsService } from '@/contacts/services/contacts.service'
import { DatabricksVoterService } from '@/peopleDb/databricks/databricksVoter.service'
import { PeopleDbxStatementClient } from '@/peopleDb/databricks/peopleDbxStatement.client'
import { createBag } from '@/peopleDb/databricks/databricksVoterSql.util'
import {
  ORG_LAYER_FIELDS,
  ORG_LAYER_IMPORT_ROW_TABLE,
  ORG_LAYER_LOG_TABLE,
  ORG_LAYER_SCHEMA,
  type OrgLayerField,
} from '@/peopleDb/databricks/orgLayer.poc'
import type { PocImportRow } from '../pocOrgLayer.schema'

const ORG_LAYER_MATCH_TABLE = `${ORG_LAYER_SCHEMA}.org_import_match`
const ROWS_PER_INSERT = 500
const SAFE_IDENTIFIER = /^[A-Za-z0-9_]+$/

const ROW_FIELD_COLUMNS = [
  ['first_name', 'FirstName'],
  ['last_name', 'LastName'],
  ['address', 'Residence_Addresses_AddressLine'],
  ['city', 'Residence_Addresses_City'],
  ['zip', 'Residence_Addresses_Zip'],
  ['phone', 'VoterTelephones_CellPhoneFormatted'],
  ['email', 'email'],
] as const

export const POC_SETTABLE_FIELDS: readonly OrgLayerField[] = [
  ...ORG_LAYER_FIELDS,
  'email',
]

@Injectable()
export class PocOrgLayerService {
  private tablesReady: Promise<void> | null = null

  constructor(
    private readonly logger: PinoLogger,
    private readonly client: PeopleDbxStatementClient,
    private readonly contacts: ContactsService,
    private readonly voters: DatabricksVoterService,
  ) {
    this.logger.setContext(PocOrgLayerService.name)
  }

  private timed = async <T>(
    timings: Record<string, number>,
    step: string,
    fn: () => Promise<T>,
  ): Promise<T> => {
    const startedAt = Date.now()
    try {
      return await fn()
    } finally {
      timings[step] = Date.now() - startedAt
    }
  }

  private ensureTables(): Promise<void> {
    this.tablesReady ??= (async () => {
      await this.client.query({
        sql:
          `CREATE TABLE IF NOT EXISTS ${ORG_LAYER_IMPORT_ROW_TABLE} (` +
          'import_id STRING, org_slug STRING, row_index INT,' +
          ' first_name STRING, last_name STRING, address STRING,' +
          ' city STRING, zip STRING, phone STRING, email STRING,' +
          ' created_at TIMESTAMP) CLUSTER BY (import_id)',
        params: [],
      })
      await this.client.query({
        sql:
          `CREATE TABLE IF NOT EXISTS ${ORG_LAYER_MATCH_TABLE} (` +
          'import_id STRING, org_slug STRING, row_index INT,' +
          ' status STRING, person_id STRING, candidate_count INT,' +
          ' created_at TIMESTAMP) CLUSTER BY (import_id)',
        params: [],
      })
    })().catch((err: Error) => {
      this.tablesReady = null
      throw err
    })
    return this.tablesReady
  }

  async importRows(org: Organization, rows: PocImportRow[]) {
    const timingsMs: Record<string, number> = {}
    const importId = randomUUID()
    const startedAt = Date.now()

    await this.timed(timingsMs, 'ensureTables', () => this.ensureTables())

    const district = await this.timed(timingsMs, 'resolveDistrict', async () => {
      const { districtId, dataset } =
        await this.contacts.resolveEligibleDistrict(org)
      return this.voters.resolveDistrict(districtId, dataset)
    })

    await this.timed(timingsMs, 'stageRows', () => {
      const batches: PocImportRow[][] = []
      for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
        batches.push(rows.slice(i, i + ROWS_PER_INSERT))
      }
      return Promise.all(
        batches.map((batch, batchIndex) => {
          const bag = createBag()
          const importIdParam = bag.bind(importId)
          const orgParam = bag.bind(org.slug)
          const values = batch.map((row, i) => {
            const cells = [
              bag.bind(batchIndex * ROWS_PER_INSERT + i, 'INT'),
              bag.bind(row.firstName),
              bag.bind(row.lastName),
              bag.bind(row.address ?? null),
              bag.bind(row.city ?? null),
              bag.bind(row.zip ?? null),
              bag.bind(row.phone ?? null),
              bag.bind(row.email ?? null),
            ]
            return (
              `(${importIdParam}, ${orgParam}, ${cells.join(', ')},` +
              ' current_timestamp())'
            )
          })
          return this.client.query({
            sql:
              `INSERT INTO ${ORG_LAYER_IMPORT_ROW_TABLE} (import_id, org_slug,` +
              ' row_index, first_name, last_name, address, city, zip, phone,' +
              ' email, created_at) VALUES ' +
              values.join(', '),
            params: bag.params,
          })
        }),
      )
    })

    if (
      !district.useVoterOnlyPath &&
      !SAFE_IDENTIFIER.test(district.districtType)
    ) {
      throw new BadRequestException('Unusable district type')
    }
    const bag = createBag()
    const importIdParam = bag.bind(importId)
    const orgParam = bag.bind(org.slug)
    const baseTable = district.table
    const districtScope = district.useVoterOnlyPath
      ? `State = ${bag.bind(district.state)}`
      : `State = ${bag.bind(district.state)} AND` +
        ` \`${district.districtType}\` = ${bag.bind(district.districtName)}`
    const digits10 = (expr: string): string =>
      `right(regexp_replace(${expr}, '[^0-9]', ''), 10)`

    await this.timed(timingsMs, 'match', () =>
      this.client.query({
        sql:
          `INSERT INTO ${ORG_LAYER_MATCH_TABLE} (import_id, org_slug,` +
          ' row_index, status, person_id, candidate_count, created_at)' +
          ` WITH r AS (SELECT row_index,` +
          ` lower(trim(last_name)) AS ln,` +
          ` lower(substr(trim(first_name), 1, 1)) AS fi,` +
          ` substr(regexp_replace(zip, '[^0-9]', ''), 1, 5) AS z5,` +
          ` ${digits10('phone')} AS ph` +
          ` FROM ${ORG_LAYER_IMPORT_ROW_TABLE}` +
          ` WHERE import_id = ${importIdParam}),` +
          ` b AS (SELECT id, lower(trim(LastName)) AS ln,` +
          ' lower(substr(trim(FirstName), 1, 1)) AS fi,' +
          ' substr(Residence_Addresses_Zip, 1, 5) AS z5,' +
          ` ${digits10('VoterTelephones_CellPhoneFormatted')} AS cell,` +
          ` ${digits10('VoterTelephones_LandlineFormatted')} AS land` +
          ` FROM ${baseTable} WHERE ${districtScope}),` +
          ' phone_hits AS (' +
          ' SELECT r.row_index, b.id FROM r JOIN b' +
          ' ON length(r.ph) = 10 AND b.cell = r.ph' +
          ' UNION SELECT r.row_index, b.id FROM r JOIN b' +
          ' ON length(r.ph) = 10 AND b.land = r.ph),' +
          ' name_hits AS (SELECT r.row_index, b.id FROM r JOIN b' +
          ' ON r.ln = b.ln AND r.z5 = b.z5 AND r.fi = b.fi' +
          ' WHERE r.row_index NOT IN (SELECT row_index FROM phone_hits)),' +
          ' hits AS (SELECT * FROM phone_hits UNION ALL' +
          ' SELECT * FROM name_hits),' +
          ' agg AS (SELECT row_index, count(DISTINCT id) AS n,' +
          ' min(id) AS any_id FROM hits GROUP BY row_index)' +
          ` SELECT ${importIdParam}, ${orgParam}, r.row_index,` +
          " CASE WHEN agg.n IS NULL THEN 'new'" +
          " WHEN agg.n = 1 THEN 'matched' ELSE 'ambiguous' END," +
          ' IF(agg.n = 1, agg.any_id, NULL),' +
          ' CAST(coalesce(agg.n, 0) AS INT), current_timestamp()' +
          ' FROM r LEFT JOIN agg ON agg.row_index = r.row_index',
        params: bag.params,
      }),
    )

    const summaryBag = createBag()
    const summary = await this.timed(timingsMs, 'matchSummary', () =>
      this.client.query({
        sql:
          'SELECT status, row_index, candidate_count' +
          ` FROM ${ORG_LAYER_MATCH_TABLE}` +
          ` WHERE import_id = ${summaryBag.bind(importId)}`,
        params: summaryBag.params,
      }),
    )
    const counts = { total: 0, matched: 0, ambiguous: 0, new: 0 }
    const ambiguous: Array<{ rowIndex: number; candidateCount: number }> = []
    for (const [status, rowIndex, candidateCount] of summary.rows) {
      counts.total++
      if (status === 'matched') counts.matched++
      if (status === 'new') counts.new++
      if (status === 'ambiguous') {
        counts.ambiguous++
        ambiguous.push({
          rowIndex: Number(rowIndex),
          candidateCount: Number(candidateCount),
        })
      }
    }
    ambiguous.sort((a, b) => a.rowIndex - b.rowIndex)
    timingsMs.total = Date.now() - startedAt

    this.logger.info(
      {
        op: 'poc-import',
        orgSlug: org.slug,
        importId,
        dataset: district.dataset,
        rows: rows.length,
        counts,
        timingsMs,
      },
      'poc org layer write',
    )
    return {
      importId,
      dataset: district.dataset,
      counts,
      ambiguous,
      timingsMs,
    }
  }

  async commitImport(org: Organization, importId: string, actorId: number) {
    const timingsMs: Record<string, number> = {}
    const startedAt = Date.now()
    const bag = createBag()
    const orgParam = bag.bind(org.slug)
    const importIdParam = bag.bind(importId)
    const actorParam = bag.bind(actorId, 'INT')
    const events = [
      "named_struct('kind', 'create', 'field', CAST(NULL AS STRING)," +
        " 'value', CAST(NULL AS STRING))",
      ...ROW_FIELD_COLUMNS.map(
        ([column, field]) =>
          `named_struct('kind', 'set', 'field', '${field}',` +
          ` 'value', x.${column})`,
      ),
    ].join(', ')
    const result = await this.timed(timingsMs, 'commit', () =>
      this.client.query({
        sql:
          `INSERT INTO ${ORG_LAYER_LOG_TABLE} (event_id, org_slug, person_id,` +
          ' kind, field, value, source, import_id, actor_user_id, created_at)' +
          ` SELECT uuid(), ${orgParam}, x.pid, e.kind, e.field, e.value,` +
          ` 'import', ${importIdParam}, ${actorParam}, current_timestamp()` +
          ' FROM (SELECT r.*, m.status,' +
          " CASE WHEN m.status = 'matched' THEN m.person_id" +
          ' ELSE uuid() END AS pid' +
          ` FROM ${ORG_LAYER_IMPORT_ROW_TABLE} r` +
          ` JOIN ${ORG_LAYER_MATCH_TABLE} m` +
          ' ON m.import_id = r.import_id AND m.row_index = r.row_index' +
          ` WHERE r.import_id = ${importIdParam}` +
          ` AND r.org_slug = ${orgParam} AND m.org_slug = ${orgParam}) x` +
          ` LATERAL VIEW explode(filter(array(${events}),` +
          " ev -> (ev.kind = 'create' AND x.status <> 'matched')" +
          " OR (ev.kind = 'set' AND nullif(trim(ev.value), '') IS NOT NULL)" +
          ')) t AS e',
        params: bag.params,
      }),
    )
    const countBag = createBag()
    const counts = await this.timed(timingsMs, 'commitSummary', async () => {
      const { rows } = await this.client.query({
        sql:
          "SELECT count_if(kind = 'create'), count_if(kind = 'set')," +
          ' count(DISTINCT person_id)' +
          ` FROM ${ORG_LAYER_LOG_TABLE}` +
          ` WHERE org_slug = ${countBag.bind(org.slug)}` +
          ` AND import_id = ${countBag.bind(importId)}`,
        params: countBag.params,
      })
      const [row] = rows
      return {
        insertedEvents: Number(result.rows[0]?.[0] ?? 0),
        createEvents: Number(row?.[0] ?? 0),
        setEvents: Number(row?.[1] ?? 0),
        people: Number(row?.[2] ?? 0),
      }
    })
    timingsMs.total = Date.now() - startedAt
    this.logger.info(
      { op: 'poc-import-commit', orgSlug: org.slug, importId, counts, timingsMs },
      'poc org layer write',
    )
    return { importId, counts, timingsMs }
  }

  async setField(
    org: Organization,
    personId: string,
    field: string,
    value: string | null,
    actorId: number,
  ) {
    if (!POC_SETTABLE_FIELDS.some((settable) => settable === field)) {
      throw new BadRequestException(
        `field must be one of ${POC_SETTABLE_FIELDS.join(', ')}`,
      )
    }
    return this.appendEvent(org, personId, 'set', actorId, field, value)
  }

  async appendEvent(
    org: Organization,
    personId: string,
    kind: 'set' | 'remove' | 'restore',
    actorId: number,
    field: string | null = null,
    value: string | null = null,
  ) {
    const timingsMs: Record<string, number> = {}
    const bag = createBag()
    await this.timed(timingsMs, 'insert', () =>
      this.client.query({
        sql:
          `INSERT INTO ${ORG_LAYER_LOG_TABLE} (event_id, org_slug, person_id,` +
          ' kind, field, value, source, import_id, actor_user_id, created_at)' +
          ` VALUES (uuid(), ${bag.bind(org.slug)}, ${bag.bind(personId)},` +
          ` ${bag.bind(kind)}, ${bag.bind(field)}, ${bag.bind(value)},` +
          ` 'manual', NULL, ${bag.bind(actorId, 'INT')}, current_timestamp())`,
        params: bag.params,
      }),
    )
    this.logger.info(
      { op: `poc-${kind}`, orgSlug: org.slug, personId, field, timingsMs },
      'poc org layer write',
    )
    return { timingsMs }
  }
}
