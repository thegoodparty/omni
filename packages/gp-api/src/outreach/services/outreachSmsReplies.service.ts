import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  type ReplyFlag,
  type ReplyFlagUpdate,
  SMS_OUTREACH_REPLIES_MAX_LIMIT,
  type SmsOutreachReplies,
  type SmsOutreachRepliesFilter,
  type SmsOutreachReply,
} from '@goodparty_org/contracts'
import { serializeError } from 'serialize-error'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { ListPeopleDTO } from '@/peopleDb/schemas/people.schema'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  ContactStatusField,
  CivicPanelStatus,
  FollowUpStatus,
  OutreachType,
  Prisma,
  PollIndividualMessageSender,
  SynthesisRunStatus,
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
 * A reply carries the viewing user's own favourite and read state
 * (OutreachReplyFlag), never another member's. There is still no thread and
 * no composer: a thread needs per-person outbound SMS the Slack fulfilment
 * path does not have. See docs/features/serve-sms.md.
 */

// A name lookup is decoration on a reply that is already readable without it.
// Bound the id set anyway so a "show everything" request can never hand
// people-api an unbounded `id in (...)`.
const MAX_NAME_LOOKUP_IDS = SMS_OUTREACH_REPLIES_MAX_LIMIT

// people-api's id filter is a guid column; a personId that is not one cannot
// match anything, and sending it would fail the whole batch's validation.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const FOLLOW_UP_REQUESTED_LABEL = 'Follow-up requested'
export const CIVIC_PANEL_MEMBER_LABEL = 'Civic panel member'

export interface ListRepliesOptions {
  limit: number
  offset: number
  userId: number
  filter: SmsOutreachRepliesFilter
  themeId?: string
  nonClustered?: boolean
}

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
    private readonly contactStatus: ContactStatusService,
  ) {
    super()
  }

  /**
   * One page of a send's replies, newest first.
   *
   * `total` counts every reply matching the filters rather than the page,
   * because the design's "Show all {n} responses" affordance names a number
   * it has not fetched yet.
   */
  async listReplies(
    outreachId: number,
    scope: OutreachScope,
    {
      limit,
      offset,
      userId,
      filter,
      themeId,
      nonClustered,
    }: ListRepliesOptions,
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
      outreach.outreachType !== OutreachType.text &&
      outreach.outreachType !== OutreachType.poll
    ) {
      throw new BadRequestException(
        'Replies are only available for text campaigns',
      )
    }

    // Inbound only. An outbound row on the same envelope is the blast itself,
    // never something a constituent said.
    const conditions: Prisma.PollIndividualMessageWhereInput[] = [
      { outreachId, sender: PollIndividualMessageSender.CONSTITUENT },
    ]
    if (filter === 'unread') {
      conditions.push({
        NOT: { replyFlags: { some: { userId, readAt: { not: null } } } },
      })
    }
    if (filter === 'favorited') {
      conditions.push({
        replyFlags: { some: { userId, favoritedAt: { not: null } } },
      })
    }
    if (themeId !== undefined) {
      conditions.push({ themeMembers: { some: { themeId } } })
    }
    if (nonClustered) {
      // Nothing is left out of an analysis that has not run yet.
      const latestRunId = await this.latestCompletedRunId(outreachId)
      if (latestRunId === null) return { total: 0, replies: [] }
      conditions.push(
        { OR: [{ isOptOut: false }, { isOptOut: null }] },
        { themeMembers: { none: { theme: { runId: latestRunId } } } },
      )
    }
    const where: Prisma.PollIndividualMessageWhereInput = { AND: conditions }

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
          replyFlags: {
            where: { userId },
            select: { favoritedAt: true, readAt: true },
          },
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

    const crm = await this.resolveCrm(
      outreachId,
      organizationSlug,
      rows.map((row) => row.personId),
    )

    const replies: SmsOutreachReply[] = rows.map((row) => {
      const identity = identities.get(row.personId)
      const flag = row.replyFlags[0]
      const contact = crm.get(row.personId)
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
        favorited: flag?.favoritedAt != null,
        read: flag?.readAt != null,
        ...(contact ? { crm: contact } : {}),
      }
    })

    return { total, replies }
  }

  /**
   * Sets the session user's favourite and read state on one reply. 404s
   * unless the reply is on a send in the caller's org, so a reply id from
   * another office is indistinguishable from one that does not exist.
   */
  async updateFlags(
    outreachId: number,
    replyId: string,
    scope: OutreachScope,
    userId: number,
    update: ReplyFlagUpdate,
  ): Promise<ReplyFlag> {
    const reply = await this.model.findFirst({
      where: {
        id: replyId,
        outreachId,
        sender: PollIndividualMessageSender.CONSTITUENT,
        outreach: { ...scope },
      },
      select: { id: true },
    })
    if (!reply) {
      throw new NotFoundException('Reply not found')
    }

    const now = new Date()
    const data = {
      ...(update.favorited === undefined
        ? {}
        : { favoritedAt: update.favorited ? now : null }),
      ...(update.read === undefined
        ? {}
        : { readAt: update.read ? now : null }),
    }
    const flag = await this.client.outreachReplyFlag.upsert({
      where: { userId_replyId: { userId, replyId } },
      create: { userId, replyId, ...data },
      update: data,
      select: { favoritedAt: true, readAt: true },
    })
    return { favorited: flag.favoritedAt !== null, read: flag.readAt !== null }
  }

  private async latestCompletedRunId(
    outreachId: number,
  ): Promise<string | null> {
    const run = await this.client.feedbackSynthesisRun.findFirst({
      where: {
        outreachId,
        status: {
          in: [SynthesisRunStatus.completed, SynthesisRunStatus.superseded],
        },
        completedAt: { not: null },
      },
      orderBy: { completedAt: Prisma.SortOrder.desc },
      select: { id: true },
    })
    return run?.id ?? null
  }

  /**
   * The CRM's own standing status label for each person, and the contact id
   * the record opens at. Nothing from the voter file: a contact id and the
   * label the contact card already shows the official.
   *
   * Degrades like `resolveIdentities`: a CRM outage must not fail a list of
   * replies the official can already read.
   */
  private async resolveCrm(
    outreachId: number,
    organizationSlug: string | null,
    personIds: string[],
  ): Promise<Map<string, { contactId: string; statusLabel: string | null }>> {
    const crm = new Map<
      string,
      { contactId: string; statusLabel: string | null }
    >()
    const ids = [...new Set(personIds)].filter((id) => UUID_RE.test(id))
    if (ids.length === 0 || !organizationSlug) return crm

    try {
      const [followUps, panel] = await Promise.all([
        this.contactStatus.currentStatusForPeople(
          organizationSlug,
          ContactStatusField.follow_up,
          ids,
        ),
        this.contactStatus.currentStatusForPeople(
          organizationSlug,
          ContactStatusField.civic_panel,
          ids,
        ),
      ])
      for (const id of ids) {
        const statusLabel =
          followUps.get(id) === FollowUpStatus.requested
            ? FOLLOW_UP_REQUESTED_LABEL
            : panel.get(id) === CivicPanelStatus.member
              ? CIVIC_PANEL_MEMBER_LABEL
              : null
        crm.set(id, { contactId: id, statusLabel })
      }
    } catch (err) {
      this.logger.warn(
        { err: serializeError(err), outreachId, personCount: ids.length },
        'Could not read CRM status for replies; returning replies without it',
      )
      crm.clear()
    }
    return crm
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
  async resolveIdentities(
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

      const { districtId, dataset } =
        await this.contactsService.resolveEligibleDistrict(organization)
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
        dataset,
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
