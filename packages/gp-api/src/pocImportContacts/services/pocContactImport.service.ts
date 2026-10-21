import { randomUUID } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  ContactImportMatchStatus,
  ContactImportResolution,
  ContactImportStatus,
  Organization,
  OrgContactLinkMethod,
  OrgContactLinkStatus,
  Prisma,
} from '@/generated/prisma'
import { ContactsService } from '@/contacts/services/contacts.service'
import { DatabricksVoterService } from '@/peopleDb/databricks/databricksVoter.service'
import { createBag } from '@/peopleDb/databricks/databricksVoterSql.util'
import { PeopleDbxStatementClient } from '@/peopleDb/databricks/peopleDbxStatement.client'
import {
  pocVendorTable,
  universalContactsViewStorage,
} from '@/peopleDb/databricks/universalContactsView.poc'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  type ImportCandidate,
  importCandidateSchema,
  type ImportContactRow,
} from '../pocImportContacts.schema'
import { PocMirrorShimService } from './pocMirrorShim.service'

const CANDIDATE_LIMIT = 20
const SAFE_IDENTIFIER = /^[A-Za-z0-9_]+$/

const nameKey = (name: string): string =>
  name.trim().toLowerCase().replace(/-/g, '')

const sqlNameKey = (column: string): string =>
  `regexp_replace(lower(trim(${column})), '-', '')`

const formatPhone = (phone: string | undefined): string | null => {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  const ten =
    digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  return ten.length === 10
    ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`
    : phone
}

const timed = async <T>(
  timingsMs: Record<string, number>,
  step: string,
  fn: () => Promise<T>,
): Promise<T> => {
  const startedAt = Date.now()
  try {
    return await fn()
  } finally {
    timingsMs[step] = Date.now() - startedAt
  }
}

@Injectable()
export class PocContactImportService extends createPrismaBase(
  MODELS.ContactImport,
) {
  constructor(
    private readonly contacts: ContactsService,
    private readonly voters: DatabricksVoterService,
    private readonly dbx: PeopleDbxStatementClient,
    private readonly mirrorShim: PocMirrorShimService,
  ) {
    super()
  }

  async createImport(
    org: Organization,
    userId: number,
    fileName: string,
    rows: ImportContactRow[],
  ) {
    const timingsMs: Record<string, number> = {}
    const district = await timed(timingsMs, 'resolveDistrict', async () => {
      const { districtId, dataset } =
        await this.contacts.resolveEligibleDistrict(org)
      return this.voters.resolveDistrict(districtId, dataset)
    })
    if (
      !district.useVoterOnlyPath &&
      !SAFE_IDENTIFIER.test(district.districtType)
    ) {
      throw new BadRequestException('Unusable district type')
    }

    const keyed = rows.map((row, rowIndex) => ({
      row,
      rowIndex,
      firstNameKey: nameKey(row.firstName),
      lastNameKey: nameKey(row.lastName),
    }))
    const keys = [
      ...new Set(keyed.map((k) => `${k.firstNameKey}|${k.lastNameKey}`)),
    ]

    const candidatesByKey = await timed(timingsMs, 'match', async () => {
      const bag = createBag()
      const scope = district.useVoterOnlyPath
        ? `State = ${bag.bind(district.state)}`
        : `State = ${bag.bind(district.state)} AND` +
          ` \`${district.districtType}\` = ${bag.bind(district.districtName)}`
      const keysParam = bag.bind(JSON.stringify(keys))
      const { rows: found } = await this.dbx.query({
        sql:
          'SELECT name_key, id, FirstName, LastName,' +
          ' Residence_Addresses_AddressLine, Residence_Addresses_City,' +
          ' Residence_Addresses_Zip, Age_Int,' +
          ' count(*) OVER (PARTITION BY name_key) AS candidate_count' +
          ` FROM (SELECT *, concat(${sqlNameKey('FirstName')}, '|',` +
          ` ${sqlNameKey('LastName')}) AS name_key` +
          ` FROM ${pocVendorTable(district.table)} WHERE ${scope})` +
          ' WHERE name_key IN' +
          ` (SELECT explode(from_json(${keysParam}, 'array<string>')))` +
          ' QUALIFY row_number() OVER (PARTITION BY name_key ORDER BY id)' +
          ` <= ${CANDIDATE_LIMIT}`,
        params: bag.params,
      })
      const byKey = new Map<
        string,
        { count: number; candidates: ImportCandidate[] }
      >()
      for (const [
        key,
        id,
        first,
        last,
        address,
        city,
        zip,
        age,
        count,
      ] of found) {
        if (!key || !id) continue
        const entry = byKey.get(key) ?? {
          count: Number(count ?? 0),
          candidates: [],
        }
        entry.candidates.push({
          personId: id,
          firstName: first ?? null,
          lastName: last ?? null,
          address: address ?? null,
          city: city ?? null,
          zip: zip ?? null,
          age: age == null ? null : Number(age),
        })
        byKey.set(key, entry)
      }
      return byKey
    })

    const stagedRows = keyed.map(
      ({ row, rowIndex, firstNameKey, lastNameKey }) => {
        const match = candidatesByKey.get(`${firstNameKey}|${lastNameKey}`)
        const candidateCount = match?.count ?? 0
        const matchStatus =
          candidateCount === 0
            ? ContactImportMatchStatus.unmatched
            : candidateCount === 1
              ? ContactImportMatchStatus.matched
              : ContactImportMatchStatus.ambiguous
        return {
          rowIndex,
          firstName: row.firstName,
          lastName: row.lastName,
          email: row.email ?? null,
          phone: formatPhone(row.phone),
          address: row.address ?? null,
          city: row.city ?? null,
          zip: row.zip ?? null,
          firstNameKey,
          lastNameKey,
          matchStatus,
          candidateCount,
          candidates: match?.candidates ?? [],
          resolvedPersonId:
            matchStatus === ContactImportMatchStatus.matched
              ? (match?.candidates[0]?.personId ?? null)
              : null,
        }
      },
    )

    const contactImport = await timed(timingsMs, 'stage', () =>
      this.client.$transaction(async (tx) => {
        const created = await tx.contactImport.create({
          data: {
            organizationSlug: org.slug,
            userId,
            fileName,
            rowCount: rows.length,
            consentAffirmedAt: new Date(),
          },
        })
        await tx.contactImportRow.createMany({
          data: stagedRows.map((row) => ({ ...row, importId: created.id })),
        })
        return created
      }),
    )

    const counts = {
      total: stagedRows.length,
      matched: stagedRows.filter(
        (r) => r.matchStatus === ContactImportMatchStatus.matched,
      ).length,
      ambiguous: stagedRows.filter(
        (r) => r.matchStatus === ContactImportMatchStatus.ambiguous,
      ).length,
      unmatched: stagedRows.filter(
        (r) => r.matchStatus === ContactImportMatchStatus.unmatched,
      ).length,
    }
    this.logger.info(
      { importId: contactImport.id, counts, timingsMs },
      'poc contact import staged',
    )
    return { importId: contactImport.id, counts, timingsMs }
  }

  private async findStagedImport(org: Organization, importId: string) {
    const contactImport = await this.model.findFirst({
      where: { id: importId, organizationSlug: org.slug },
    })
    if (!contactImport) throw new NotFoundException('Import not found')
    return contactImport
  }

  async listAmbiguousRows(
    org: Organization,
    importId: string,
    page: number,
    pageSize: number,
  ) {
    const contactImport = await this.findStagedImport(org, importId)
    const where = {
      importId,
      matchStatus: ContactImportMatchStatus.ambiguous,
    }
    const [total, rows] = await Promise.all([
      this.client.contactImportRow.count({ where }),
      this.client.contactImportRow.findMany({
        where,
        orderBy: { rowIndex: Prisma.SortOrder.asc },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])
    return {
      status: contactImport.status,
      total,
      page,
      pageSize,
      rows: rows.map((row) => ({
        rowIndex: row.rowIndex,
        firstName: row.firstName,
        lastName: row.lastName,
        address: row.address,
        city: row.city,
        zip: row.zip,
        candidateCount: row.candidateCount,
        candidates: importCandidateSchema.array().parse(row.candidates),
        resolution: row.resolution,
        resolvedPersonId: row.resolvedPersonId,
      })),
    }
  }

  async resolveRow(
    org: Organization,
    importId: string,
    rowIndex: number,
    personId: string | null,
  ) {
    const contactImport = await this.findStagedImport(org, importId)
    if (contactImport.status !== ContactImportStatus.staged) {
      throw new ConflictException('Import is no longer staged')
    }
    const row = await this.client.contactImportRow.findUnique({
      where: { importId_rowIndex: { importId, rowIndex } },
    })
    if (!row || row.matchStatus !== ContactImportMatchStatus.ambiguous) {
      throw new NotFoundException('No ambiguous row at that index')
    }
    if (
      personId &&
      !importCandidateSchema
        .array()
        .parse(row.candidates)
        .some((c) => c.personId === personId)
    ) {
      throw new BadRequestException('That person is not a candidate')
    }
    const updated = await this.client.contactImportRow.update({
      where: { id: row.id },
      data: {
        resolution: personId
          ? ContactImportResolution.link
          : ContactImportResolution.skip,
        resolvedPersonId: personId,
      },
    })
    return {
      rowIndex: updated.rowIndex,
      resolution: updated.resolution,
      resolvedPersonId: updated.resolvedPersonId,
    }
  }

  async commitImport(org: Organization, importId: string, userId: number) {
    const timingsMs: Record<string, number> = {}
    await this.findStagedImport(org, importId)

    const { contacts, links } = await timed(timingsMs, 'commit', () =>
      this.client.$transaction(async (tx) => {
        const claimed = await tx.contactImport.updateMany({
          where: {
            id: importId,
            organizationSlug: org.slug,
            status: ContactImportStatus.staged,
          },
          data: {
            status: ContactImportStatus.committed,
            committedAt: new Date(),
          },
        })
        if (claimed.count === 0) {
          throw new ConflictException('Import was already committed')
        }
        const rows = await tx.contactImportRow.findMany({
          where: { importId },
          orderBy: { rowIndex: Prisma.SortOrder.asc },
        })
        const planned = rows.map((row) => {
          const contactId = randomUUID()
          const vendorPersonId =
            row.matchStatus === ContactImportMatchStatus.matched ||
            row.resolution === ContactImportResolution.link
              ? row.resolvedPersonId
              : null
          return {
            contact: {
              id: contactId,
              organizationSlug: org.slug,
              firstName: row.firstName,
              lastName: row.lastName,
              email: row.email,
              phone: row.phone,
              address: row.address,
              city: row.city,
              zip: row.zip,
              sourceImportId: importId,
            },
            link: {
              organizationSlug: org.slug,
              orgContactId: contactId,
              vendorPersonId,
              status: vendorPersonId
                ? OrgContactLinkStatus.verified
                : OrgContactLinkStatus.unverified,
              method: row.resolution
                ? OrgContactLinkMethod.manual
                : OrgContactLinkMethod.exact_name,
              actorUserId: userId,
            },
          }
        })
        return {
          contacts: await tx.orgContact.createManyAndReturn({
            data: planned.map((p) => p.contact),
          }),
          links: await tx.orgContactLink.createManyAndReturn({
            data: planned.map((p) => p.link),
          }),
        }
      }),
    )

    const { mirrored, mirrorMs } = await this.mirrorShim
      .mirror(contacts, links)
      .catch((err: Error) => {
        this.logger.warn(
          { err, importId },
          'poc import contacts mirror shim failed',
        )
        return { mirrored: false, mirrorMs: 0 }
      })
    timingsMs.mirrorShim = mirrorMs

    const counts = {
      contacts: contacts.length,
      verified: links.filter((l) => l.status === OrgContactLinkStatus.verified)
        .length,
      unverified: links.filter(
        (l) => l.status === OrgContactLinkStatus.unverified,
      ).length,
    }
    this.logger.info(
      { importId, counts, mirrored, timingsMs },
      'poc contact import committed',
    )
    return { importId, counts, mirrored, timingsMs }
  }

  async universalCounts(org: Organization) {
    const timingsMs: Record<string, number> = {}
    const { districtId, dataset } =
      await this.contacts.resolveEligibleDistrict(org)
    const district = await universalContactsViewStorage.run(
      { orgSlug: org.slug },
      () => this.voters.resolveDistrict(districtId, dataset),
    )
    const bag = createBag()
    const scope = district.useVoterOnlyPath
      ? `v.State = ${bag.bind(district.state)}`
      : `v.State = ${bag.bind(district.state)} AND` +
        ` v.\`${district.districtType}\` = ${bag.bind(district.districtName)}`
    const { rows } = await timed(timingsMs, 'count', () =>
      this.dbx.query({
        sql:
          'SELECT count(*), count(v.contact_id),' +
          ' count_if(v.contact_id IS NOT NULL AND v.contact_verified),' +
          ' count_if(v.contact_id IS NOT NULL AND NOT v.contact_verified)' +
          ` FROM ${district.table} v WHERE ${scope}`,
        params: bag.params,
      }),
    )
    const [total, contacts, verified, unverified] = rows[0] ?? []
    return {
      total: Number(total ?? 0),
      contacts: Number(contacts ?? 0),
      verified: Number(verified ?? 0),
      unverified: Number(unverified ?? 0),
      timingsMs,
    }
  }
}
