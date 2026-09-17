import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MagicLinkKind } from '../generated/prisma'
import {
  MagicLinkDeliveryService,
  SMS_CONSENT_REQUIRED_ERROR,
  SMS_NO_ACTIVE_LINK_ERROR,
  SMS_NO_SLUG_ERROR,
  SMS_OPTED_OUT_ERROR,
} from './magicLinkDelivery.service'

const inAWeek = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
const anHourAgo = () => new Date(Date.now() - 60 * 60 * 1000)

const activeLink = {
  slug: 'K7m2Qx4bNp3v',
  expiresAt: inAWeek(),
  redeemedAt: null,
  onboardingCompletedAt: null,
}

function makeService(overrides?: {
  user?: Record<string, unknown> | null
  link?: Record<string, unknown> | null
  sendResult?: unknown
}) {
  const magicLink = {
    getByUserId: vi
      .fn()
      .mockResolvedValue(
        overrides?.link === undefined ? activeLink : overrides.link,
      ),
    recordSmsSent: vi.fn().mockResolvedValue(undefined),
  }
  const users = {
    findUser: vi
      .fn()
      .mockResolvedValue(
        overrides?.user === undefined
          ? { id: 1, smsConsentAt: new Date(), smsOptedOutAt: null }
          : overrides.user,
      ),
    updateUser: vi.fn().mockResolvedValue(undefined),
  }
  const sms = {
    sendSms: vi
      .fn()
      .mockResolvedValue(
        overrides?.sendResult ?? { sent: true, messageId: 'msg_1' },
      ),
  }
  const logger = {
    setContext: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }

  const service = new MagicLinkDeliveryService(
    magicLink as never,
    users as never,
    sms as never,
    logger as never,
  )
  return { service, magicLink, users, sms }
}

const send = (service: MagicLinkDeliveryService, extra = {}) =>
  service.textActiveLink({
    userId: 1,
    kind: MagicLinkKind.SERVE,
    phone: '5551234567',
    ...extra,
  })

describe('MagicLinkDeliveryService.textActiveLink', () => {
  beforeEach(() => vi.clearAllMocks())

  it('texts the short link when consent is already on file', async () => {
    const { service, sms, magicLink } = makeService()

    await expect(send(service)).resolves.toEqual({ smsSent: true })

    // The message must carry the short link, never the ~743-character ticketed URL.
    const { body } = sms.sendSms.mock.calls[0]![0] as { body: string }
    expect(body).toContain(`/s/${activeLink.slug}`)
    expect(magicLink.recordSmsSent).toHaveBeenCalledWith({
      userId: 1,
      kind: MagicLinkKind.SERVE,
      phone: '5551234567',
      messageId: 'msg_1',
    })
  })

  it('refuses to send without consent, and does not call Sinch', async () => {
    const { service, sms } = makeService({
      user: { id: 1, smsConsentAt: null, smsOptedOutAt: null },
    })

    await expect(send(service)).resolves.toEqual({
      smsSent: false,
      smsError: SMS_CONSENT_REQUIRED_ERROR,
    })
    expect(sms.sendSms).not.toHaveBeenCalled()
  })

  it('records consent the first time a rep asserts it, then sends', async () => {
    const { service, users, sms } = makeService({
      user: { id: 1, smsConsentAt: null, smsOptedOutAt: null },
    })

    await expect(
      send(service, { smsConsent: true, consentSource: 'rep@goodparty.org' }),
    ).resolves.toEqual({ smsSent: true })

    expect(users.updateUser).toHaveBeenCalledWith(
      { id: 1 },
      expect.objectContaining({ smsConsentSource: 'rep@goodparty.org' }),
    )
    expect(sms.sendSms).toHaveBeenCalled()
  })

  it('refuses to send to a lead who replied STOP, even if the rep re-checks consent', async () => {
    const { service, sms } = makeService({
      user: {
        id: 1,
        smsConsentAt: new Date(),
        smsOptedOutAt: new Date(),
      },
    })

    await expect(send(service, { smsConsent: true })).resolves.toEqual({
      smsSent: false,
      smsError: SMS_OPTED_OUT_ERROR,
    })
    expect(sms.sendSms).not.toHaveBeenCalled()
  })

  it('reports a Sinch failure without consuming or invalidating the link', async () => {
    const { service, magicLink } = makeService({
      sendResult: { sent: false, error: 'Sinch returned 500: boom' },
    })

    await expect(send(service)).resolves.toEqual({
      smsSent: false,
      smsError: 'Sinch returned 500: boom',
    })
    // Nothing was written, so the link the rep can copy is still the live one.
    expect(magicLink.recordSmsSent).not.toHaveBeenCalled()
  })

  it('still reports success when recording delivery metadata fails', async () => {
    const { service, magicLink } = makeService()
    magicLink.recordSmsSent.mockRejectedValue(new Error('db down'))

    // The text has already left our hands; a bookkeeping failure must not tell
    // the rep to send it again.
    await expect(send(service)).resolves.toEqual({ smsSent: true })
  })

  it('refuses when there is no link, or the link is no longer redeemable', async () => {
    const missing = makeService({ link: null })
    await expect(send(missing.service)).resolves.toEqual({
      smsSent: false,
      smsError: SMS_NO_ACTIVE_LINK_ERROR,
    })

    const expired = makeService({
      link: { ...activeLink, expiresAt: anHourAgo() },
    })
    await expect(send(expired.service)).resolves.toEqual({
      smsSent: false,
      smsError: SMS_NO_ACTIVE_LINK_ERROR,
    })

    const redeemed = makeService({
      link: { ...activeLink, redeemedAt: new Date() },
    })
    await expect(send(redeemed.service)).resolves.toEqual({
      smsSent: false,
      smsError: SMS_NO_ACTIVE_LINK_ERROR,
    })
  })

  // Consent used to be written before the link was read, so a rep asserting it
  // against an expired or missing link left the lead marked as having opted in
  // during a session that texted nothing — a consent record standing on a send
  // that never happened.
  it('does not bank consent when there is no link to text', async () => {
    for (const link of [
      null,
      { ...activeLink, expiresAt: anHourAgo() },
      { ...activeLink, slug: null },
    ]) {
      const { service, users, sms } = makeService({
        user: { id: 1, smsConsentAt: null, smsOptedOutAt: null },
        link,
      })

      const result = await send(service, { smsConsent: true })

      expect(result.smsSent).toBe(false)
      expect(users.updateUser).not.toHaveBeenCalled()
      expect(sms.sendSms).not.toHaveBeenCalled()
    }
  })

  // The consent questions stay ahead of the link read, which is why the fix
  // above moved only the write. An opted-out lead has to hear about the
  // opt-out: answering "generate a new one first" would send the rep to mint a
  // link and try again, which is the loop the opt-out exists to end.
  it('reports the opt-out, not the stale link, when both are true', async () => {
    const { service, sms } = makeService({
      user: { id: 1, smsConsentAt: new Date(), smsOptedOutAt: new Date() },
      link: null,
    })

    await expect(send(service, { smsConsent: true })).resolves.toEqual({
      smsSent: false,
      smsError: SMS_OPTED_OUT_ERROR,
    })
    expect(sms.sendSms).not.toHaveBeenCalled()
  })

  // Order matters in the other direction too: the row has to carry consent
  // before the first message goes out, so a vendor success can never be the
  // thing that outruns the record of why we were allowed to send it.
  it('records consent before calling Sinch, not after', async () => {
    const calls: string[] = []
    const { service, users, sms } = makeService({
      user: { id: 1, smsConsentAt: null, smsOptedOutAt: null },
    })
    users.updateUser.mockImplementation(() => {
      calls.push('consent')
      return Promise.resolve(undefined)
    })
    sms.sendSms.mockImplementation(() => {
      calls.push('sms')
      return Promise.resolve({ sent: true, messageId: 'msg_1' })
    })

    await expect(send(service, { smsConsent: true })).resolves.toEqual({
      smsSent: true,
    })
    expect(calls).toEqual(['consent', 'sms'])
  })

  it('refuses a pre-short-link row rather than texting the long URL', async () => {
    const { service, sms } = makeService({
      link: { ...activeLink, slug: null },
    })

    await expect(send(service)).resolves.toEqual({
      smsSent: false,
      smsError: SMS_NO_SLUG_ERROR,
    })
    expect(sms.sendSms).not.toHaveBeenCalled()
  })
})
