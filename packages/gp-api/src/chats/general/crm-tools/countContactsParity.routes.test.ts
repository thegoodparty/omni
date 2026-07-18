import { HttpService } from '@nestjs/axios'
import { of } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { buildCountContactsTool } from './countContacts.tool'

const service = useTestService()

const ORG_SLUG_HEADER = 'X-Organization-Slug'
const DISTRICT_ID = 'district-crm-tool-parity-uuid'

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
          personId: 'person-responded-1',
          occurredAt: new Date('2026-07-01T12:00:00.000Z'),
          respondedAt: new Date('2026-07-02T12:00:00.000Z'),
          manual: false,
        },
        {
          organizationSlug: slug,
          personId: 'person-silent-1',
          occurredAt: new Date('2026-07-01T12:00:00.000Z'),
          manual: false,
        },
      ],
    })

    const postSpy = vi
      .spyOn(service.app.get(HttpService), 'post')
      .mockReturnValue(
        of({ data: { pagination: { totalResults: 7 } } }) as never,
      )

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

    // Both paths must have sent people-api the exact same request body —
    // same resolved id filter, same demographic filters, same search.
    expect(postSpy).toHaveBeenCalledTimes(2)
    const [routeCall, toolCall] = postSpy.mock.calls
    expect(routeCall?.[0]).toBe(toolCall?.[0])
    expect(routeCall?.[1]).toEqual(toolCall?.[1])
  })
})
