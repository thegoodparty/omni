import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  IdOverrides,
  PhoneBankingCreate,
  PhoneBankingCreateResponse,
  PhoneBankingInteraction,
  PhoneBankingList as PhoneBankingListResponse,
  PhoneBankingListEntry,
  PhoneBankingListPerson,
  PhoneBankingPurpose,
  Person,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  ContactsFilterResolutionInput,
  ContactsService,
} from '@/contacts/services/contacts.service'
import { FilterObject } from '@/contacts/utils/voterFileFilter.utils'
import { ContactStatusService } from '@/contactInteraction/services/contactStatus.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { ListPeopleDTO } from '@/peopleDb/schemas/people.schema'
import {
  Campaign,
  ContactStatusField,
  NotAVoterStatus,
  Organization,
  OutreachStatus,
  OutreachType,
  Prisma,
  PhoneBankingPurpose as PrismaPhoneBankingPurpose,
} from '../../generated/prisma'

// The frozen artifact's household grouping: how many entries print per call
// sheet. sheetCount (1-20, contracts) x this = the entry cap (max 1,200).
const PHONE_BANKING_SHEET_SIZE = 60
// Mirrors p2pPhoneListUpload.service.ts's SEGMENT_PAGE_SIZE — the page size
// the resolved audience is paged through during a build.
const BUILD_PAGE_SIZE = 1000
// Safety valve against a runaway loop on an audience that keeps resolving
// pages with nobody usable (no name / no unsuppressed number) — the entry
// cap is the real bound once any usable numbers exist. Same shape as
// p2pPhoneListUpload.service.ts's MAX_PHONE_LIST_PAGES.
const MAX_BUILD_PAGES = 101
// No external call runs inside this transaction, but the nested
// entries->persons create can be several thousand rows for a large sheet
// count — well past Prisma's default 5s transaction timeout.
const BUILD_TX_TIMEOUT_MS = 60_000

const EMPTY_AUDIENCE_MESSAGE =
  'No matching voters with a phone number — widen the filters'

const PURPOSE_TO_DB: Record<PhoneBankingPurpose, PrismaPhoneBankingPurpose> = {
  introduce: PrismaPhoneBankingPurpose.introduce,
  persuade: PrismaPhoneBankingPurpose.persuade,
  event: PrismaPhoneBankingPurpose.event,
  'vote-early': PrismaPhoneBankingPurpose.vote_early,
  'election-day': PrismaPhoneBankingPurpose.election_day,
  custom: PrismaPhoneBankingPurpose.custom,
}

const PURPOSE_FROM_DB: Record<PrismaPhoneBankingPurpose, PhoneBankingPurpose> =
  {
    [PrismaPhoneBankingPurpose.introduce]: 'introduce',
    [PrismaPhoneBankingPurpose.persuade]: 'persuade',
    [PrismaPhoneBankingPurpose.event]: 'event',
    [PrismaPhoneBankingPurpose.vote_early]: 'vote-early',
    [PrismaPhoneBankingPurpose.election_day]: 'election-day',
    [PrismaPhoneBankingPurpose.custom]: 'custom',
  }

const LIST_WITH_ENTRIES_INCLUDE = {
  entries: {
    orderBy: { seq: Prisma.SortOrder.asc },
    include: { persons: true },
  },
} as const satisfies Prisma.PhoneBankingListInclude

type ListWithEntries = Prisma.PhoneBankingListGetPayload<{
  include: typeof LIST_WITH_ENTRIES_INCLUDE
}>

type PersonName = { personId: string; name: string; firstName: string | null }

const formatAddress = (address: Person['address']): string | null => {
  const cityState = [address.city, address.state].filter(Boolean).join(', ')
  const line2 = [cityState, address.zip].filter(Boolean).join(' ')
  const parts = [address.line1, line2].filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

@Injectable()
export class PhoneBankingListService extends createPrismaBase(
  MODELS.PhoneBankingList,
) {
  constructor(
    private readonly contacts: ContactsService,
    private readonly contactStatus: ContactStatusService,
    private readonly voterQuery: VoterQueryService,
  ) {
    super()
  }

  async create(
    organization: Organization,
    campaign: Campaign | null,
    input: PhoneBankingCreate,
  ): Promise<PhoneBankingCreateResponse> {
    const districtId =
      await this.contacts.resolveEligibleDistrictId(organization)

    const filterInput = await this.loadPersistedFilter(
      input.voterFileFilterId,
      organization.slug,
    )

    const resolved = await this.contacts.resolveSavedFilterForQuery(
      organization,
      filterInput,
    )
    if (resolved.empty) {
      throw new BadRequestException(EMPTY_AUDIENCE_MESSAGE)
    }

    const notAVoterIds = new Set(
      await this.contactStatus.personIdsByFieldValue(
        organization.slug,
        ContactStatusField.not_a_voter,
        [NotAVoterStatus.moved, NotAVoterStatus.deceased],
      ),
    )
    const suppressedPhones = new Set(
      (
        await this.client.phoneBankingSuppressedPhone.findMany({
          where: { organizationSlug: organization.slug },
          select: { phone: true },
        })
      ).map((row) => row.phone),
    )

    const maxEntries = input.sheetCount * PHONE_BANKING_SHEET_SIZE
    const grouped = await this.pageAudience({
      districtId,
      search: filterInput.search || undefined,
      filters: resolved.filters,
      idOverrides: resolved.idOverrides,
      contactsMadeIdOverrides: resolved.contactsMadeIdOverrides,
      notAVoterIds,
      suppressedPhones,
      maxEntries,
    })
    if (grouped.size === 0) {
      throw new BadRequestException(EMPTY_AUDIENCE_MESSAGE)
    }

    return this.freeze(organization, campaign, input, grouped)
  }

  async getForOrganization(
    id: number,
    organization: Organization,
  ): Promise<PhoneBankingListResponse> {
    const list = await this.model.findFirst({
      where: { id, organizationSlug: organization.slug },
      include: LIST_WITH_ENTRIES_INCLUDE,
    })
    if (!list) {
      throw new NotFoundException('Phone banking list not found')
    }
    return this.toResponse(list, organization)
  }

  async delete(id: number, organizationSlug: string): Promise<void> {
    const list = await this.model.findFirst({
      where: { id, organizationSlug },
      select: { id: true },
    })
    if (!list) {
      throw new NotFoundException('Phone banking list not found')
    }
    // The schema's onDelete: Cascade chain (entries -> persons, the
    // interaction table's list FK, and the Outreach envelope's
    // phoneBankingListId FK) does the rest of the cleanup in this one
    // statement — nothing else needs deleting here. PhoneBankingSuppressedPhone
    // has no relation to PhoneBankingList, so it's untouched by construction.
    await this.model.delete({ where: { id } })
  }

  private async loadPersistedFilter(
    voterFileFilterId: number,
    organizationSlug: string,
  ): Promise<ContactsFilterResolutionInput> {
    const filter = await this.client.voterFileFilter.findFirst({
      where: { id: voterFileFilterId, organizationSlug },
      include: { activityConditions: true },
    })
    if (!filter) {
      throw new NotFoundException('Voter file filter not found')
    }
    return filter
  }

  private async pageAudience(args: {
    districtId: string
    search?: string
    filters: FilterObject
    idOverrides?: IdOverrides
    contactsMadeIdOverrides?: IdOverrides
    notAVoterIds: Set<string>
    suppressedPhones: Set<string>
    maxEntries: number
  }): Promise<Map<string, PersonName[]>> {
    const {
      districtId,
      search,
      filters,
      idOverrides,
      contactsMadeIdOverrides,
      notAVoterIds,
      suppressedPhones,
      maxEntries,
    } = args
    const grouped = new Map<string, PersonName[]>()

    let page = 1
    while (true) {
      if (page > MAX_BUILD_PAGES) {
        throw new BadRequestException(
          `Pagination exceeded ${MAX_BUILD_PAGES} pages — aborting`,
        )
      }
      const { people } = await this.voterQuery.findPeople(
        ListPeopleDTO.create({
          districtId,
          filters,
          idOverrides,
          contactsMadeIdOverrides,
          search,
          resultsPerPage: BUILD_PAGE_SIZE,
          page,
          groupByHousehold: false,
          skipCount: true,
        }),
      )

      for (const person of people) {
        if (notAVoterIds.has(person.id)) continue
        const name = [person.firstName, person.lastName]
          .filter(Boolean)
          .join(' ')
        if (!name) continue
        const phone = this.pickDialNumber(person, suppressedPhones)
        if (!phone) continue

        const firstName = person.firstName ?? null
        const existing = grouped.get(phone)
        if (existing) {
          existing.push({ personId: person.id, name, firstName })
        } else if (grouped.size < maxEntries) {
          grouped.set(phone, [{ personId: person.id, name, firstName }])
        }
      }

      if (grouped.size >= maxEntries) break
      if (people.length < BUILD_PAGE_SIZE) break
      page += 1
    }

    return grouped
  }

  private pickDialNumber(
    person: Person,
    suppressedPhones: Set<string>,
  ): string | null {
    if (person.cellPhone && !suppressedPhones.has(person.cellPhone)) {
      return person.cellPhone
    }
    if (person.landline && !suppressedPhones.has(person.landline)) {
      return person.landline
    }
    return null
  }

  private async freeze(
    organization: Organization,
    campaign: Campaign | null,
    input: PhoneBankingCreate,
    grouped: Map<string, PersonName[]>,
  ): Promise<PhoneBankingCreateResponse> {
    const entriesData = [...grouped.entries()].map(
      ([phone, persons], index) => {
        const seq = index + 1
        return {
          seq,
          sheetIndex: Math.ceil(seq / PHONE_BANKING_SHEET_SIZE),
          phone,
          persons: {
            create: persons.map((person) => ({
              personId: person.personId,
              name: person.name,
              firstName: person.firstName,
            })),
          },
        }
      },
    )
    const personCount = [...grouped.values()].reduce(
      (sum, persons) => sum + persons.length,
      0,
    )

    return this.client.$transaction(
      async (tx) => {
        const list = await tx.phoneBankingList.create({
          data: {
            organizationSlug: organization.slug,
            voterFileFilterId: input.voterFileFilterId,
            name: input.name,
            script: input.script,
            sheetCount: input.sheetCount,
            purpose: PURPOSE_TO_DB[input.purpose],
            entries: { create: entriesData },
          },
        })

        // First outreach launch against this filter locks it from edits,
        // same as door-knocking's knock and the CRM's own launch path.
        await tx.voterFileFilter.updateMany({
          where: {
            id: input.voterFileFilterId,
            firstUsedForOutreachAt: null,
          },
          data: { firstUsedForOutreachAt: new Date() },
        })

        let outreachId: number | null = null
        if (campaign) {
          const outreach = await tx.outreach.create({
            data: {
              campaignId: campaign.id,
              organizationSlug: campaign.organizationSlug,
              outreachType: OutreachType.nativePhoneBanking,
              status: OutreachStatus.in_progress,
              name: input.name,
              voterFileFilterId: input.voterFileFilterId,
              phoneBankingListId: list.id,
              date: new Date(),
            },
          })
          outreachId = outreach.id
        }

        return {
          id: list.id,
          name: list.name,
          sheetCount: list.sheetCount,
          entryCount: entriesData.length,
          personCount,
          outreachId,
        }
      },
      { timeout: BUILD_TX_TIMEOUT_MS },
    )
  }

  private async toResponse(
    list: ListWithEntries,
    organization: Organization,
  ): Promise<PhoneBankingListResponse> {
    const personIds = [
      ...new Set(
        list.entries.flatMap((entry) =>
          entry.persons.map((person) => person.personId),
        ),
      ),
    ]

    const [liveByPersonId, interactionByPersonId] = await Promise.all([
      this.fetchLivePeople(personIds, organization),
      this.fetchInteractions(list.id, personIds),
    ])

    const entries: PhoneBankingListEntry[] = list.entries.map((entry) => ({
      id: entry.id,
      seq: entry.seq,
      sheetIndex: entry.sheetIndex,
      phone: entry.phone,
      persons: entry.persons.map((person): PhoneBankingListPerson => {
        const live = liveByPersonId.get(person.personId) ?? null
        return {
          personId: person.personId,
          name: person.name,
          firstName: person.firstName,
          age: live?.age ?? null,
          party: organization.slug.startsWith('eo-')
            ? null
            : (live?.politicalParty ?? null),
          address: live ? formatAddress(live.address) : null,
          cellPhone: live?.cellPhone ?? null,
          landline: live?.landline ?? null,
          interaction: interactionByPersonId.get(person.personId) ?? null,
        }
      }),
    }))

    return {
      id: list.id,
      name: list.name,
      script: list.script,
      sheetCount: list.sheetCount,
      purpose: PURPOSE_FROM_DB[list.purpose],
      createdAt: list.createdAt,
      entries,
    }
  }

  // One batched IN query, never per-entry (people-db has hit 57014 statement
  // timeouts on the per-entry query shape — see the p2p schedule-validation
  // incident). A missing live row is not an error; the caller renders the
  // frozen snapshot instead.
  private async fetchLivePeople(
    personIds: string[],
    organization: Organization,
  ): Promise<Map<string, Person>> {
    if (personIds.length === 0) return new Map()

    const districtId =
      await this.contacts.resolveEligibleDistrictId(organization)
    const { people } = await this.voterQuery.findPeople(
      ListPeopleDTO.create({
        districtId,
        filters: { id: { in: personIds } },
        resultsPerPage: personIds.length,
        page: 1,
        groupByHousehold: false,
        skipCount: true,
      }),
    )
    return new Map(people.map((person) => [person.id, person]))
  }

  private async fetchInteractions(
    phoneBankingListId: number,
    personIds: string[],
  ): Promise<Map<string, PhoneBankingInteraction>> {
    if (personIds.length === 0) return new Map()
    const interactions =
      await this.client.contactInteractionPhoneBanking.findMany({
        where: { phoneBankingListId, personId: { in: personIds } },
      })
    return new Map(
      interactions.map((interaction) => [
        interaction.personId,
        {
          outcome: interaction.outcome,
          supportAnswer: interaction.supportAnswer,
          willVote: interaction.willVote,
          occurredAt: interaction.occurredAt,
        },
      ]),
    )
  }
}
