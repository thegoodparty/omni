import { describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
import { buildCountContactsTool } from './countContacts.tool'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'
// districtId and the resolved activity-condition/support-status id set both
// now flow through the real people-db Zod DTOs (ListPeopleDTO etc.), which
// require GUID-shaped strings — unlike the legacy people-api HTTP path, which
// just serialized these into a JSON body with no format validation.
const DISTRICT_ID = '40000000-0000-0000-0000-000000000000'
const PERSON_RESPONDED = '00000000-0000-0000-0000-000000000001'
const PERSON_SILENT = '00000000-0000-0000-0000-000000000002'

// The tool must produce the same count as POST /v1/contacts/count for the
// identical payload because it calls the same service method — this pins
// that: same seeded interaction rows, same activity-condition filter, and a
// byte-identical people-api request from both paths.
describe('count_contacts tool ↔ POST /v1/contacts/count parity', () => {
  it('returns the route count for a demographic + supportStatus + activity filter', async () => {
    const slug = `eo-crm-parity-${Date.now()}`
    await service.prisma.organization.create({
      data: {
        slug,
        ownerId: service.user.id,
        overrideDistrictId: DISTRICT_ID,
      },
    })
    // One responded text interaction (matches the condition) and one silent
    // one (excluded by actions: ['responded']), so the activity-condition
    // resolution against real Postgres produces a non-trivial id filter.
    await service.prisma.contactInteractionText.createMany({
      data: [
        {
          organizationSlug: slug,
          personId: PERSON_RESPONDED,
          occurredAt: new Date('2026-07-01T12:00:00.000Z'),
          respondedAt: new Date('2026-07-02T12:00:00.000Z'),
          manual: false,
        },
        {
          organizationSlug: slug,
          personId: PERSON_SILENT,
          occurredAt: new Date('2026-07-01T12:00:00.000Z'),
          manual: false,
        },
      ],
    })

    // People data resolves through the in-process VoterQueryService now
    // instead of the legacy people-api HTTP client — this suite doesn't run
    // a real people-db, so the local service call is stubbed directly.
    const postSpy = vi
      .spyOn(service.app.get(VoterQueryService), 'findPeople')
      .mockResolvedValue({
        people: [],
        pagination: {
          totalResults: 7,
          currentPage: 1,
          pageSize: 1,
          totalPages: 1,
          hasNextPage: false,
          hasPreviousPage: false,
        },
      } as never)

    const filter = {
      hasCellPhone: true,
      age18_25: true,
      supportStatus: ['unknown'],
      activityConditions: [
        { outreachType: 'text', outreachId: null, actions: ['responded'] },
      ],
    }

    const routeResponse = await service.client.post(
      '/v1/contacts/count',
      filter,
      { headers: { [ORG_SLUG_HEADER]: slug } },
    )
    expect(routeResponse.status).toBe(201)
    expect(routeResponse.data).toEqual({ count: 7 })

    const organization = await service.prisma.organization.findUniqueOrThrow({
      where: { slug },
    })
    const tool = buildCountContactsTool({
      contacts: service.app.get(ContactsService),
      organization,
    })
    const toolResult = await tool.execute(tool.inputSchema.parse(filter))

    expect(toolResult).toEqual({ count: routeResponse.data.count })

    // Both paths must have sent the people-db query the exact same request —
    // same resolved id filter, same demographic filters, same search.
    expect(postSpy).toHaveBeenCalledTimes(2)
    const [routeCall, toolCall] = postSpy.mock.calls
    expect(routeCall?.[0]).toEqual(toolCall?.[0])
  })
})
