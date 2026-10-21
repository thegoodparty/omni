import { Injectable, OnModuleInit } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { OrgContact, OrgContactLink } from '@/generated/prisma'
import { PeopleDbxStatementClient } from '@/peopleDb/databricks/peopleDbxStatement.client'
import { createBag } from '@/peopleDb/databricks/databricksVoterSql.util'
import { DEFAULT_MIRROR_SCHEMA } from '@/peopleDb/databricks/universalContactsView.poc'

// POC stand-in for a phase-1 mirror of gp-api Postgres. Off unless
// POC_IMPORT_CONTACTS_MIRROR_SHIM=true. Right after each Postgres write it
// MERGEs the changed rows by id into Delta copies of org_contact and
// org_contact_link, with the same table and column names a real mirror has.
// Delete this once a phase-1 path mirrors those tables.
const ORG_CONTACT_COLUMNS = [
  ['id', 'string'],
  ['created_at', 'timestamp'],
  ['updated_at', 'timestamp'],
  ['organization_slug', 'string'],
  ['first_name', 'string'],
  ['last_name', 'string'],
  ['email', 'string'],
  ['phone', 'string'],
  ['address', 'string'],
  ['city', 'string'],
  ['zip', 'string'],
  ['source_import_id', 'string'],
  ['do_not_contact_at', 'timestamp'],
  ['deleted_at', 'timestamp'],
] as const

const ORG_CONTACT_LINK_COLUMNS = [
  ['id', 'string'],
  ['created_at', 'timestamp'],
  ['updated_at', 'timestamp'],
  ['organization_slug', 'string'],
  ['org_contact_id', 'string'],
  ['vendor_person_id', 'string'],
  ['status', 'string'],
  ['method', 'string'],
  ['actor_user_id', 'int'],
  ['revoked_at', 'timestamp'],
] as const

const MERGE_PARAM_CHARS = 900_000

type MirrorColumns = ReadonlyArray<readonly [string, string]>
type MirrorValue = string | number | null

export const isMirrorShimEnabled = (): boolean =>
  process.env.POC_IMPORT_CONTACTS_MIRROR_SHIM === 'true'

@Injectable()
export class PocMirrorShimService implements OnModuleInit {
  private tablesReady: Promise<void> | null = null

  constructor(
    private readonly logger: PinoLogger,
    private readonly client: PeopleDbxStatementClient,
  ) {
    this.logger.setContext(PocMirrorShimService.name)
  }

  // The view reads these tables before the first import writes them.
  onModuleInit() {
    if (!isMirrorShimEnabled()) return
    this.ensureTables().catch((err: Error) =>
      this.logger.warn({ err }, 'poc import contacts mirror tables not ready'),
    )
  }

  async mirror(contacts: OrgContact[], links: OrgContactLink[]) {
    if (!isMirrorShimEnabled()) return { mirrored: false, mirrorMs: 0 }
    const startedAt = Date.now()
    await this.ensureTables()
    await this.merge(
      'org_contact',
      ORG_CONTACT_COLUMNS,
      contacts.map((contact) => ({
        id: contact.id,
        created_at: contact.createdAt.toISOString(),
        updated_at: contact.updatedAt.toISOString(),
        organization_slug: contact.organizationSlug,
        first_name: contact.firstName,
        last_name: contact.lastName,
        email: contact.email,
        phone: contact.phone,
        address: contact.address,
        city: contact.city,
        zip: contact.zip,
        source_import_id: contact.sourceImportId,
        do_not_contact_at: contact.doNotContactAt?.toISOString() ?? null,
        deleted_at: contact.deletedAt?.toISOString() ?? null,
      })),
    )
    await this.merge(
      'org_contact_link',
      ORG_CONTACT_LINK_COLUMNS,
      links.map((link) => ({
        id: link.id,
        created_at: link.createdAt.toISOString(),
        updated_at: link.updatedAt.toISOString(),
        organization_slug: link.organizationSlug,
        org_contact_id: link.orgContactId,
        vendor_person_id: link.vendorPersonId,
        status: link.status,
        method: link.method,
        actor_user_id: link.actorUserId,
        revoked_at: link.revokedAt?.toISOString() ?? null,
      })),
    )
    const mirrorMs = Date.now() - startedAt
    this.logger.info(
      { contacts: contacts.length, links: links.length, mirrorMs },
      'poc import contacts mirror shim merged',
    )
    return { mirrored: true, mirrorMs }
  }

  private ensureTables(): Promise<void> {
    const ddl = (table: string, columns: MirrorColumns) =>
      this.client.query({
        sql:
          `CREATE TABLE IF NOT EXISTS ${DEFAULT_MIRROR_SCHEMA}.${table} (` +
          columns.map(([name, type]) => `${name} ${type}`).join(', ') +
          ') CLUSTER BY (organization_slug)',
        params: [],
      })
    this.tablesReady ??= (async () => {
      await ddl('org_contact', ORG_CONTACT_COLUMNS)
      await ddl('org_contact_link', ORG_CONTACT_LINK_COLUMNS)
    })().catch((err: Error) => {
      this.tablesReady = null
      throw err
    })
    return this.tablesReady
  }

  // Databricks caps a statement's bound parameters at 1,048,576 characters,
  // so the rows go over in batches under that.
  private async merge(
    table: string,
    columns: MirrorColumns,
    rows: Record<string, MirrorValue>[],
  ) {
    const rowType = `array<struct<${columns
      .map(([name, type]) => `${name}:${type}`)
      .join(',')}>>`
    const batches: string[][] = [[]]
    let batchSize = 0
    for (const row of rows) {
      const json = JSON.stringify(row)
      if (batchSize + json.length > MERGE_PARAM_CHARS && batchSize > 0) {
        batches.push([])
        batchSize = 0
      }
      batches[batches.length - 1]?.push(json)
      batchSize += json.length + 1
    }
    for (const batch of batches) {
      if (batch.length === 0) continue
      const bag = createBag()
      const source = bag.bind(`[${batch.join(',')}]`)
      await this.client.query({
        sql:
          `MERGE INTO ${DEFAULT_MIRROR_SCHEMA}.${table} t` +
          ` USING (SELECT inline(from_json(${source}, '${rowType}'))) s` +
          ' ON t.id = s.id' +
          ' WHEN MATCHED THEN UPDATE SET *' +
          ' WHEN NOT MATCHED THEN INSERT *',
        params: bag.params,
      })
    }
  }
}
