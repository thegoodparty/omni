import { randomUUID } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import {
  CIVIC_PANEL_JOIN_LINE,
  type CivicPanelJoinPage,
} from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import { ManagedCivicPanelStatus } from '@/generated/prisma'
import type { PersonOutput } from '@/contacts/schemas/person.schema'
import { ContactsService } from '@/contacts/services/contacts.service'
import { CivicPanelJoinService } from '@/contacts/services/civicPanelJoin.service'
import { CivicPanelJoinRateLimitGuard } from '@/contacts/guards/civicPanelJoinRateLimit.guard'
import { FeaturesService } from '@/features/services/features.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'

const service = useTestService()

const INVITE = `Hi, it's Mayor Lee.\n\n${CIVIC_PANEL_JOIN_LINE}\n\nReply STOP to opt out.`
const PHONE = '(303) 555-0142'
const PHONE_DIGITS = '3035550142'
const FIRST_NAME = 'Rosalind'
const LAST_NAME = 'Okafor'

const path = (code: string) => `/v1/civic-panel/join/${code}`

const body = (overrides: Record<string, unknown> = {}) => ({
  firstName: FIRST_NAME,
  lastName: LAST_NAME,
  phone: PHONE,
  consent: true,
  ...overrides,
})

let isFeatureEnabled: Mock<FeaturesService['isFeatureEnabled']>
let findPersonByPhone: Mock<ContactsService['findPersonByPhone']>

beforeEach(() => {
  vi.spyOn(
    service.app.get(CivicPanelJoinRateLimitGuard),
    'canActivate',
  ).mockReturnValue(true)
  isFeatureEnabled = vi
    .fn<FeaturesService['isFeatureEnabled']>()
    .mockResolvedValue(true)
  vi.spyOn(
    service.app.get(FeaturesService),
    'isFeatureEnabled',
  ).mockImplementation(isFeatureEnabled)
  findPersonByPhone = vi
    .fn<ContactsService['findPersonByPhone']>()
    .mockResolvedValue(null)
  vi.spyOn(
    service.app.get(ContactsService),
    'findPersonByPhone',
  ).mockImplementation(findPersonByPhone)
  vi.spyOn(
    service.app.get(OrganizationsService),
    'resolvePositionNameByOrganizationSlug',
  ).mockResolvedValue('Mayor')
  vi.spyOn(
    service.app.get(OrganizationsService),
    'getDistrictForOrgSlug',
  ).mockResolvedValue({
    id: 'district-1',
    state: 'CO',
    l2Type: 'City',
    l2Name: 'City of Maplewood',
  })
})

const enroll = async (
  status: ManagedCivicPanelStatus = ManagedCivicPanelStatus.exhausted,
) => {
  const slug = `eo-join-page-${randomUUID()}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  const enrollment = await service.prisma.managedCivicPanel.create({
    data: {
      organizationSlug: slug,
      status,
      inviteMessage: INVITE,
      consentVersion: '2026-10-22',
      approvedAt: new Date(),
      approvedByUserId: service.user.id,
      goalMembers: 250,
    },
  })
  return { slug, code: enrollment.shareCode }
}

const join = (code: string, payload = body()) =>
  service.client.post(path(code), payload, { validateStatus: () => true })

const read = (code: string) =>
  service.client.get<CivicPanelJoinPage>(path(code), {
    validateStatus: () => true,
  })

const memberIds = async (slug: string) =>
  (
    await service.prisma.contactCurrentStatus.findMany({
      where: { organizationSlug: slug, field: 'civic_panel', value: 'member' },
      select: { personId: true },
    })
  ).map((row) => row.personId)

describe('the civic panel join page with the flag off', () => {
  it('404s, and nobody joins', async () => {
    const { slug, code } = await enroll()
    isFeatureEnabled.mockResolvedValue(false)

    expect((await read(code)).status).toBe(HttpStatus.NOT_FOUND)
    expect((await join(code)).status).toBe(HttpStatus.NOT_FOUND)
    expect(await memberIds(slug)).toEqual([])
    expect(isFeatureEnabled).toHaveBeenCalledWith({
      user: service.user.id,
      feature: 'serve-citizen-panels',
    })
  })
})

describe('GET /v1/civic-panel/join/:code', () => {
  it('names the official, the office and the place', async () => {
    const { code } = await enroll()

    const res = await read(code)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({
      officialName: `${service.user.firstName} ${service.user.lastName}`,
      officeName: 'Mayor',
      place: 'Maplewood',
      open: true,
    })
  })

  it('reads closed once the office stopped its panel', async () => {
    const { code } = await enroll(ManagedCivicPanelStatus.stopped)

    expect((await read(code)).data.open).toBe(false)
  })

  it('404s an unknown code and 400s a malformed one', async () => {
    expect((await read('abcdefabcdef')).status).toBe(HttpStatus.NOT_FOUND)
    expect((await read('not-a-code')).status).toBe(HttpStatus.BAD_REQUEST)
  })
})

describe('POST /v1/civic-panel/join/:code', () => {
  it('puts a voter-file match on the panel once, however often they join', async () => {
    const { slug, code } = await enroll()
    const personId = randomUUID()
    findPersonByPhone.mockResolvedValue({ id: personId } as PersonOutput)

    const first = await join(code)
    const again = await join(code)

    expect(first.status).toBe(HttpStatus.OK)
    expect(first.data).toEqual({ received: true })
    expect(again.data).toEqual({ received: true })
    expect(await memberIds(slug)).toEqual([personId])
    expect(findPersonByPhone).toHaveBeenCalledTimes(1)
    const events = await service.prisma.contactStatusEvent.findMany({
      where: { organizationSlug: slug, field: 'civic_panel' },
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      personId,
      toValue: 'member',
      source: 'share_page',
      actorUserId: null,
    })
  })

  it('still joins someone the voter file does not hold', async () => {
    const { slug, code } = await enroll()

    await join(code)

    const joiner = await service.prisma.civicPanelJoiner.findUniqueOrThrow({
      where: {
        organizationSlug_phone: { organizationSlug: slug, phone: PHONE_DIGITS },
      },
    })
    expect(joiner).toMatchObject({
      matched: false,
      source: 'share_page',
      firstName: FIRST_NAME,
      lastName: LAST_NAME,
    })
    expect(await memberIds(slug)).toEqual([joiner.personId])
  })

  it('answers the same for someone who opted out, and does not add them', async () => {
    const { slug, code } = await enroll()
    const personId = randomUUID()
    findPersonByPhone.mockResolvedValue({ id: personId } as PersonOutput)
    const outreach = await service.prisma.outreach.create({
      data: {
        organizationSlug: slug,
        outreachType: 'text',
        status: 'completed',
      },
    })
    await service.prisma.contactInteractionText.create({
      data: {
        outreachId: outreach.id,
        organizationSlug: slug,
        personId,
        occurredAt: new Date(),
        optedOutAt: new Date(),
      },
    })

    const res = await join(code)

    expect(res.data).toEqual({ received: true })
    expect(await memberIds(slug)).toEqual([])
  })

  it('404s once the office stopped its panel', async () => {
    const { slug, code } = await enroll(ManagedCivicPanelStatus.stopped)

    expect((await join(code)).status).toBe(HttpStatus.NOT_FOUND)
    expect(await memberIds(slug)).toEqual([])
  })

  it('400s without consent or a US phone number', async () => {
    const { code } = await enroll()

    expect((await join(code, body({ consent: false }))).status).toBe(
      HttpStatus.BAD_REQUEST,
    )
    expect((await join(code, body({ phone: '555-01234' }))).status).toBe(
      HttpStatus.BAD_REQUEST,
    )
  })

  it('never logs the name or number', async () => {
    const { code } = await enroll()
    const logger = service.app.get(CivicPanelJoinService).logger
    const info = vi.spyOn(logger, 'info')
    const warn = vi.spyOn(logger, 'warn')

    await join(code)

    const logged = JSON.stringify([info.mock.calls, warn.mock.calls])
    expect(info).toHaveBeenCalled()
    expect(logged).not.toContain(PHONE_DIGITS)
    expect(logged).not.toContain(FIRST_NAME)
    expect(logged).not.toContain(LAST_NAME)
  })

  it('refuses a caller past a few joins', async () => {
    vi.mocked(
      service.app.get(CivicPanelJoinRateLimitGuard).canActivate,
    ).mockRestore()
    const { code } = await enroll()

    const statuses: number[] = []
    for (let i = 0; i < 7; i++) {
      statuses.push(
        (await join(code, body({ phone: `30355501${50 + i}` }))).status,
      )
    }

    expect(statuses).toContain(HttpStatus.TOO_MANY_REQUESTS)
  })
})
