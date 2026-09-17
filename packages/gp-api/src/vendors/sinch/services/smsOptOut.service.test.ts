import { describe, expect, it } from 'vitest'
import { useTestService } from '../../../test-service'
import { SmsOptOutService } from './smsOptOut.service'

const service = useTestService()

const LEAD_PHONE = '+15551234567'

const at = (iso: string) => new Date(iso)

/** The number is attributed through MagicLink.phone — what we actually texted. */
const textedLink = async (phone: string | null = LEAD_PHONE) => {
  const { id: userId, email } = service.user
  await service.prisma.magicLink.create({
    data: {
      userId,
      email,
      url: 'https://app/serve/welcome?__clerk_ticket=tok',
      slug: `slug${Math.random().toString(36).slice(2, 10)}`,
      sentAt: at('2026-08-01T00:00:00.000Z'),
      expiresAt: at('2026-12-01T00:00:00.000Z'),
      phone,
    },
  })
  return userId
}

const userRow = (userId: number) =>
  service.prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { smsOptedOutAt: true, smsOptEventAt: true },
  })

describe('SmsOptOutService.setOptedOut', () => {
  it('records the opt-out at the time the person texted STOP', async () => {
    const svc = service.app.get(SmsOptOutService)
    const userId = await textedLink()

    const count = await svc.setOptedOut(
      LEAD_PHONE,
      true,
      at('2026-09-01T12:00:00.000Z'),
    )

    expect(count).toBe(1)
    // The event's own time, not now: it is when consent was withdrawn, and it
    // is the value the next callback is compared against.
    await expect(userRow(userId)).resolves.toEqual({
      smsOptedOutAt: at('2026-09-01T12:00:00.000Z'),
      smsOptEventAt: at('2026-09-01T12:00:00.000Z'),
    })
  })

  // The replay this ordering exists to defeat. A captured callback keeps its
  // original signed timestamp forever, so it can be resent but not made newer.
  it('refuses a replayed STOP that would undo a later START', async () => {
    const svc = service.app.get(SmsOptOutService)
    const userId = await textedLink()

    const stop = at('2026-09-01T12:00:00.000Z')
    await svc.setOptedOut(LEAD_PHONE, true, stop)
    // The lead changes their mind and texts START.
    await svc.setOptedOut(LEAD_PHONE, false, at('2026-09-02T12:00:00.000Z'))

    // Someone resends the captured STOP.
    const replayed = await svc.setOptedOut(LEAD_PHONE, true, stop)

    expect(replayed).toBe(0)
    await expect(userRow(userId)).resolves.toEqual({
      smsOptedOutAt: null,
      smsOptEventAt: at('2026-09-02T12:00:00.000Z'),
    })
  })

  // The same guard read the other way, and the one with teeth: re-enabling
  // texts to someone who opted out is a TCPA problem, not an annoyance.
  it('refuses a replayed START over a newer STOP', async () => {
    const svc = service.app.get(SmsOptOutService)
    const userId = await textedLink()

    const start = at('2026-09-01T12:00:00.000Z')
    await svc.setOptedOut(LEAD_PHONE, false, start)
    await svc.setOptedOut(LEAD_PHONE, true, at('2026-09-02T12:00:00.000Z'))

    expect(await svc.setOptedOut(LEAD_PHONE, false, start)).toBe(0)
    await expect(userRow(userId)).resolves.toEqual({
      smsOptedOutAt: at('2026-09-02T12:00:00.000Z'),
      smsOptEventAt: at('2026-09-02T12:00:00.000Z'),
    })
  })

  // Sinch does not guarantee callback order, so this is a normal delivery, not
  // an attack — and it used to land the person in the state they did not pick.
  it('keeps the newer state when callbacks arrive out of order', async () => {
    const svc = service.app.get(SmsOptOutService)
    const userId = await textedLink()

    await svc.setOptedOut(LEAD_PHONE, false, at('2026-09-02T12:00:00.000Z'))
    // The earlier STOP shows up afterwards, delayed or requeued.
    await svc.setOptedOut(LEAD_PHONE, true, at('2026-09-01T12:00:00.000Z'))

    await expect(userRow(userId)).resolves.toMatchObject({
      smsOptedOutAt: null,
    })
  })

  // A retry of a callback we already processed, which Sinch sends with the
  // original timestamp. Applying it again must be a no-op rather than an error.
  it('treats an exact retry as already applied', async () => {
    const svc = service.app.get(SmsOptOutService)
    const userId = await textedLink()
    const stop = at('2026-09-01T12:00:00.000Z')

    expect(await svc.setOptedOut(LEAD_PHONE, true, stop)).toBe(1)
    expect(await svc.setOptedOut(LEAD_PHONE, true, stop)).toBe(0)

    await expect(userRow(userId)).resolves.toEqual({
      smsOptedOutAt: stop,
      smsOptEventAt: stop,
    })
  })

  it('ignores a number we have never texted', async () => {
    const svc = service.app.get(SmsOptOutService)
    await textedLink()

    const count = await svc.setOptedOut(
      '+15559998888',
      true,
      at('2026-09-01T12:00:00.000Z'),
    )

    expect(count).toBe(0)
  })

  it('ignores a number it cannot parse', async () => {
    const svc = service.app.get(SmsOptOutService)

    await expect(
      svc.setOptedOut('not-a-phone', true, at('2026-09-01T12:00:00.000Z')),
    ).resolves.toBe(0)
  })
})
