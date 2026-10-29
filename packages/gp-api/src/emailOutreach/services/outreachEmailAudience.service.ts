import { BadRequestException, Injectable } from '@nestjs/common'
import { addMilliseconds, isAfter } from 'date-fns'
import { MAX_RESULTS_PER_PAGE } from '@goodparty_org/contracts'
import {
  ContactsFilterResolutionInput,
  ContactsService,
} from '@/contacts/services/contacts.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import { Organization } from '../../generated/prisma'
import {
  EMAIL_AUDIENCE_DELIVERY_BUDGET_MS,
  EMAIL_AUDIENCE_MAX_RESOLVED,
} from '../emailOutreach.const'
import { capName, emailDomain, normalizeEmail } from '../util/emailAddress.util'
import { EmailDomainCheckService } from './emailDomainCheck.service'

export type AudienceResolveRow = {
  id: number
  senderId: number
  recipientCap: number
  audienceCursor: string | null
  organizationSlug: string
  voterFileFilterId: number | null
}

// done: every recipient the send needs is written. more: this delivery's
// time is up, and the cursor is saved for the next one. moved: another
// delivery advanced the cursor first, so this one stops.
export type AudienceResolveOutcome = 'done' | 'more' | 'moved'

type Recipient = {
  email: string
  firstName: string | null
  lastName: string | null
}

// An email send's audience: a saved voter-file list with the email filter
// forced, so only people with an email address are counted or sent to.
@Injectable()
export class OutreachEmailAudienceService extends createPrismaBase(
  MODELS.OutreachEmailRecipient,
) {
  constructor(
    private readonly contacts: ContactsService,
    private readonly voterFileFilters: VoterFileFilterService,
    private readonly domainCheck: EmailDomainCheckService,
  ) {
    super()
  }

  async assertListBelongs(
    organizationSlug: string,
    voterFileFilterId: number,
  ): Promise<void> {
    await this.emailFilterFor(organizationSlug, voterFileFilterId)
  }

  // One server-side count. A client count is never used to price a send.
  async countWithEmail(
    organizationSlug: string,
    voterFileFilterId: number,
  ): Promise<number> {
    const filter = await this.emailFilterFor(
      organizationSlug,
      voterFileFilterId,
    )
    const { pagination } = await this.contacts.findContactsForFilter(
      filter,
      { resultsPerPage: 1, page: 1 },
      await this.organizationFor(organizationSlug),
    )
    return pagination.totalResults
  }

  // Writes the audience onto the send in pages, never holding more than one
  // page in memory. Recipients sort by never-emailed first, so once the send
  // has `recipientCap` people who are neither unsubscribed nor emailed by
  // this sender before, no later page can reach the cap and the resolve
  // stops. Each page is one keyset read (id order) and one insert that skips
  // anyone already on the send.
  async resolve(
    row: AudienceResolveRow,
    suppressionSlugs: string[],
  ): Promise<AudienceResolveOutcome> {
    const filter =
      row.voterFileFilterId === null
        ? null
        : await this.voterFileFilters.findByIdAndOrganizationSlug(
            row.voterFileFilterId,
            row.organizationSlug,
          )
    if (!filter) {
      // The list was deleted after confirm. The send resolves to nobody,
      // and settle ends it canceled with nothing charged.
      this.logger.warn(
        { outreachEmailId: row.id },
        'Email send audience list is gone; sending to nobody',
      )
      return this.finish(row.id)
    }
    const emailFilter: ContactsFilterResolutionInput = {
      ...filter,
      hasEmail: true,
    }
    const organization = await this.organizationFor(row.organizationSlug)
    const dataset = await this.contacts.resolvePeopleDataset(organization)
    const deadline = addMilliseconds(
      new Date(),
      EMAIL_AUDIENCE_DELIVERY_BUDGET_MS,
    )
    const checkedDomains = new Map<string, boolean>()
    let cursor = row.audienceCursor
    let written = await this.model.count({
      where: { outreachEmailId: row.id },
    })
    let fresh = await this.countFresh(row.id, suppressionSlugs)

    while (fresh < row.recipientCap) {
      if (written >= EMAIL_AUDIENCE_MAX_RESOLVED) {
        this.logger.warn(
          { outreachEmailId: row.id, written },
          'Email send audience hit the resolve limit; the rest is not sent',
        )
        break
      }
      if (isAfter(new Date(), deadline)) return 'more'

      const { people } = await this.contacts.findContactsForFilter(
        emailFilter,
        {
          resultsPerPage: MAX_RESULTS_PER_PAGE,
          page: 1,
          skipCount: true,
          ...(cursor === null ? {} : { afterId: cursor }),
        },
        organization,
        undefined,
        dataset,
      )
      const last = people.at(-1)
      if (!last) break

      const recipients = await this.deliverable(
        people.flatMap((person) => {
          const email = person.email ? normalizeEmail(person.email) : null
          return email
            ? [
                {
                  email,
                  firstName: capName(person.firstName ?? ''),
                  lastName: capName(person.lastName ?? ''),
                },
              ]
            : []
        }),
        checkedDomains,
      )
      const inserted = await this.insertPage(
        row.id,
        row.senderId,
        recipients,
        suppressionSlugs,
      )
      written += inserted.written
      fresh += inserted.fresh

      const moved = await this.client.outreachEmail.updateMany({
        where: { id: row.id, audienceCursor: cursor },
        data: { audienceCursor: last.id },
      })
      if (moved.count === 0) return 'moved'
      cursor = last.id
      if (people.length < MAX_RESULTS_PER_PAGE) break
    }
    return this.finish(row.id)
  }

  private async finish(outreachEmailId: number): Promise<'done'> {
    await this.client.outreachEmail.update({
      where: { id: outreachEmailId },
      data: { audienceResolvedAt: new Date() },
    })
    return 'done'
  }

  private async emailFilterFor(
    organizationSlug: string,
    voterFileFilterId: number,
  ): Promise<ContactsFilterResolutionInput> {
    const filter = await this.voterFileFilters.findByIdAndOrganizationSlug(
      voterFileFilterId,
      organizationSlug,
    )
    if (!filter) {
      throw new BadRequestException('That list was not found')
    }
    return { ...filter, hasEmail: true }
  }

  private async organizationFor(slug: string): Promise<Organization> {
    const organization = await this.client.organization.findUnique({
      where: { slug },
    })
    if (!organization) {
      throw new BadRequestException(`Organization ${slug} not found`)
    }
    return organization
  }

  // In-page duplicates and addresses whose domain takes no mail are dropped.
  // Domains are looked up once per delivery.
  private async deliverable(
    recipients: Recipient[],
    checkedDomains: Map<string, boolean>,
  ): Promise<Recipient[]> {
    const unique = [...new Map(recipients.map((r) => [r.email, r])).values()]
    const unchecked = [
      ...new Set(unique.map((r) => emailDomain(r.email))),
    ].filter((domain) => !checkedDomains.has(domain))
    const bad = await this.domainCheck.findUndeliverableDomains(unchecked)
    unchecked.forEach((domain) => checkedDomains.set(domain, !bad.has(domain)))
    return unique.filter((r) => checkedDomains.get(emailDomain(r.email)))
  }

  // One insert per page. Someone already on the send is skipped by the
  // (send, email) unique key, so a redelivered page adds nobody twice. It
  // returns how many it wrote, and how many of those could be sent to:
  // not unsubscribed, and never emailed by this sender.
  private async insertPage(
    outreachEmailId: number,
    senderId: number,
    recipients: Recipient[],
    suppressionSlugs: string[],
  ): Promise<{ written: number; fresh: number }> {
    if (recipients.length === 0) return { written: 0, fresh: 0 }
    const [counts] = await this.client.$queryRaw<
      { written: number; fresh: number }[]
    >`
      WITH inserted AS (
        INSERT INTO outreach_email_recipient
          (outreach_email_id, sender_id, email, first_name, last_name)
        SELECT ${outreachEmailId}, ${senderId}, page.email,
          page.first_name, page.last_name
        FROM unnest(
          ${recipients.map((r) => r.email)}::text[],
          ${recipients.map((r) => r.firstName)}::text[],
          ${recipients.map((r) => r.lastName)}::text[]
        ) AS page(email, first_name, last_name)
        ON CONFLICT (outreach_email_id, email) DO NOTHING
        RETURNING email
      )
      SELECT COUNT(*)::int AS written,
        (COUNT(*) FILTER (
          WHERE NOT EXISTS (
            SELECT 1 FROM outreach_email_suppression s
            WHERE s.email = i.email
              AND s.organization_slug = ANY(${suppressionSlugs})
              AND s.revoked_at IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM outreach_email_recipient p
            WHERE p.sender_id = ${senderId}
              AND p.email = i.email
              AND p.sent_at IS NOT NULL
          )
        ))::int AS fresh
      FROM inserted i
    `
    return counts ?? { written: 0, fresh: 0 }
  }

  // The same count over everyone already written, for a delivery that
  // resumes after an earlier one wrote some pages.
  private async countFresh(
    outreachEmailId: number,
    suppressionSlugs: string[],
  ): Promise<number> {
    const [row] = await this.client.$queryRaw<{ fresh: number }[]>`
      SELECT COUNT(*)::int AS fresh
      FROM outreach_email_recipient r
      WHERE r.outreach_email_id = ${outreachEmailId}
        AND NOT EXISTS (
          SELECT 1 FROM outreach_email_suppression s
          WHERE s.email = r.email
            AND s.organization_slug = ANY(${suppressionSlugs})
            AND s.revoked_at IS NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM outreach_email_recipient p
          WHERE p.sender_id = r.sender_id
            AND p.email = r.email
            AND p.sent_at IS NOT NULL
        )
    `
    return row?.fresh ?? 0
  }
}
