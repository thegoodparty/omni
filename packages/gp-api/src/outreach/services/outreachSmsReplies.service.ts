import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  SMS_OUTREACH_REPLIES_MAX_LIMIT,
  type SmsOutreachReplies,
  type SmsOutreachReply,
} from '@goodparty_org/contracts'
import { serializeError } from 'serialize-error'
import { ContactsService } from '@/contacts/services/contacts.service'
import { ListPeopleDTO } from '@/peopleDb/schemas/people.schema'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  OutreachType,
  PollIndividualMessageSender,
} from '../../generated/prisma'
import type { OutreachScope } from './outreach.service'

/**
 * The read-only reply list behind the results surface.
 *
 * Reply CONTENT lives on `poll_individual_message` and nowhere else: the Win
 * inbound sweep records reply/opt-out TIMESTAMPS on ContactInteractionText
 * and never the body, which is why `getSmsResults` can be counts-only while
 * this reader cannot. A6 generalized that table so a row belongs to a poll OR
 * to a text outreach (the DB CHECK enforces the XOR), and the shared ingest
 * writes the outreach half.
 *
 * Read-only is the product decision, not a stub: no favourite flag, no read
 * state, no thread, no composer. A thread needs per-person outbound SMS the
 * Slack fulfilment path does not have. See docs/features/serve-sms.md,
 * "Out of scope in v1".
 */

// A name lookup is decoration on a reply that is already readable without it.
// Bound the id set anyway so a "show everything" request can never hand
// people-api an unbounded `id in (...)`.
const MAX_NAME_LOOKUP_IDS = SMS_OUTREACH_REPLIES_MAX_LIMIT

// people-api's id filter is a guid column; a personId that is not one cannot
// match anything, and sending it would fail the whole batch's validation.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface PersonIdentity {
  firstName: string | null
  lastName: string | null
  city: string | null
  state: string | null
}

@Injectable()
export class OutreachSmsRepliesService extends createPrismaBase(
  MODELS.PollIndividualMessage,
) {
  constructor(
    private readonly contactsService: ContactsService,
    private readonly voterQuery: VoterQueryService,
  ) {
    super()
  }

  /**
   * One page of a send's replies, newest first.
   *
   * `total` counts every reply on the send rather than the page, because the
   * design's "Show all {n} responses" affordance names a number it has not
   * fetched yet.
   */
  async listReplies(
    outreachId: number,
    scope: OutreachScope,
    { limit, offset }: { limit: number; offset: number },
  ): Promise<SmsOutreachReplies> {
    const outreach = await this.client.outreach.findFirst({
      where: { id: outreachId, ...scope },
      select: {
        id: true,
        outreachType: true,
        organizationSlug: true,
        campaign: { select: { organizationSlug: true } },
      },
    })
    if (!outreach) {
      throw new NotFoundException('Outreach not found')
    }
    if (
      outreach.outreachType !== OutreachType.p2p &&
      outreach.outreachType !== OutreachType.text
    ) {
      throw new BadRequestException(
        'Replies are only available for text campaigns',
      )
    }

    // Inbound only. An outbound row on the same envelope is the blast itself,
    // never something a constituent said.
    const where = {
      outreachId,
      sender: PollIndividualMessageSender.CONSTITUENT,
    } as const

    const [total, rows] = await Promise.all([
      this.client.pollIndividualMessage.count({ where }),
      this.client.pollIndividualMessage.findMany({
        where,
        orderBy: [{ sentAt: 'desc' }, { id: 'asc' }],
        skip: offset,
        take: limit,
        select: {
          id: true,
          personId: true,
          personCellPhone: true,
          content: true,
          sentAt: true,
          isOptOut: true,
        },
      }),
    ])

    // Win rows scope by campaign, Serve rows by organization — the same
    // either-surface resolution the shared ingest does.
    const organizationSlug =
      outreach.organizationSlug ?? outreach.campaign?.organizationSlug ?? null
    const identities = await this.resolveIdentities(
      outreachId,
      organizationSlug,
      rows.map((row) => row.personId),
    )

    const replies: SmsOutreachReply[] = rows.map((row) => {
      const identity = identities.get(row.personId)
      return {
        id: row.id,
        personId: row.personId,
        firstName: identity?.firstName ?? null,
        lastName: identity?.lastName ?? null,
        city: identity?.city ?? null,
        state: identity?.state ?? null,
        phone: row.personCellPhone,
        content: row.content ?? '',
        receivedAt: row.sentAt.toISOString(),
        isOptOut: row.isOptOut ?? false,
      }
    })

    return { total, replies }
  }

  /**
   * Names and place for the page's people, in ONE people-api read.
   *
   * `filters.id.in` rather than a lookup per reply: the ingest's
   * phone-by-phone fallback pays a query per unmatched number because it has
   * only phones to search on, but a reply row already carries the personId
   * people-api keys on.
   *
   * Degrades rather than throws. A name is decoration on a reply the official
   * can already read, and a people-api outage must not empty the list.
   *
   * Straight to VoterQueryService rather than through ContactsService.
   * findContacts, which is a search/segment reader and would need a segment
   * this has no business inventing. The Serve party-visibility rule
   * (ENG-10696) is not sidestepped by that: ContactsService strips the key
   * on the way out, and this projects four identity fields by hand, none of
   * which is `politicalParty`.
   */
  private async resolveIdentities(
    outreachId: number,
    organizationSlug: string | null,
    personIds: string[],
  ): Promise<Map<string, PersonIdentity>> {
    const identities = new Map<string, PersonIdentity>()
    const ids = [...new Set(personIds)]
      .filter((id) => UUID_RE.test(id))
      .slice(0, MAX_NAME_LOOKUP_IDS)
    if (ids.length === 0 || !organizationSlug) return identities

    try {
      const organization = await this.client.organization.findUnique({
        where: { slug: organizationSlug },
      })
      if (!organization) return identities

      const districtId =
        await this.contactsService.resolveEligibleDistrictId(organization)
      const { people } = await this.voterQuery.findPeople(
        ListPeopleDTO.create({
          districtId,
          filters: { id: { in: ids } },
          resultsPerPage: ids.length,
          page: 1,
          // The caller already knows how many replies there are; a COUNT over
          // the district to re-derive it would be pure waste.
          skipCount: true,
        }),
      )
      for (const person of people) {
        identities.set(person.id, {
          firstName: person.firstName ?? null,
          lastName: person.lastName ?? null,
          city: person.address?.city ?? null,
          state: person.address?.state ?? person.state ?? null,
        })
      }
    } catch (err) {
      this.logger.warn(
        { err: serializeError(err), outreachId, personCount: ids.length },
        'Could not resolve reply author names; returning replies unnamed',
      )
    }
    return identities
  }
}
