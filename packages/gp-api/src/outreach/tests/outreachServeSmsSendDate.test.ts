import { HttpStatus } from '@nestjs/common'
import { addBusinessDays, format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CIVIC_PANEL_JOIN_LINES } from '@goodparty_org/contracts'
import { FeaturesService } from '@/features/services/features.service'
import { useTestService } from '@/test-service'

const service = useTestService()

// Ops schedules every Serve text by hand, so a new send needs its date on
// the 3rd business day or later. Counted from today where the server counts
// it, so the test agrees with the gate whatever the runner's timezone.
const businessDaysOut = (days: number): string =>
  format(
    addBusinessDays(toZonedTime(new Date(), 'America/Los_Angeles'), days),
    'yyyy-MM-dd',
  )

describe('a civic panel invite text dated inside the ops lead', () => {
  let slug: string
  let filterId: number

  beforeEach(async () => {
    slug = `eo-lead-${Date.now()}-${Math.random().toString(36).slice(2)}`
    await service.prisma.organization.create({
      data: { slug, ownerId: service.user.id },
    })
    await service.prisma.electedOffice.create({
      data: { userId: service.user.id, organizationSlug: slug },
    })
    filterId = (
      await service.prisma.voterFileFilter.create({
        data: {
          organizationSlug: slug,
          name: 'Civic panel invite',
          civicPanelInvite: true,
        },
      })
    ).id
    vi.spyOn(
      service.app.get(FeaturesService),
      'isFeatureEnabled',
    ).mockResolvedValue(true)
  })

  const createInvite = (scheduledLocalDate: string) =>
    service.client.post(
      '/v1/outreach/serve/sms',
      {
        name: 'Civic panel invite',
        message: `this is Jane, your Council Member. Join my civic panel.\n\n${CIVIC_PANEL_JOIN_LINES[0]}\n\nReply STOP to opt out.`,
        imageUrl: 'https://assets.test/header.png',
        scheduledLocalDate,
        voterFileFilterId: filterId,
      },
      { headers: { 'x-organization-slug': slug } },
    )

  it.each([0, 1, 2])(
    'refuses a send %i business days out and saves nothing',
    async (days) => {
      const res = await createInvite(businessDaysOut(days))

      expect(res.status).toBe(HttpStatus.BAD_REQUEST)
      expect(JSON.stringify(res.data)).toMatch(
        /at least 2 business days from today/,
      )
      expect(
        await service.prisma.outreach.count({
          where: { organizationSlug: slug },
        }),
      ).toBe(0)
    },
  )
})
