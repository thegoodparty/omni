import { Injectable } from '@nestjs/common'
import { nanoid } from 'nanoid'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { MagicLink, MagicLinkKind } from '../generated/prisma'
import { CrmUsersService } from '../users/services/crmUsers.service'

// 12 chars over nanoid's URL-safe alphabet (~72 bits). The slug is the whole
// credential behind /s/<slug>, and the SMS segment budget makes the extra
// characters free versus a tighter length.
const SLUG_LENGTH = 12

/**
 * Owns the sales-initiated magic-link lifecycle (source of truth in gp-db) and
 * mirrors the derived status onto HubSpot contact properties so the sales App
 * Card can show persistent state across close/reopen. All transitions are
 * best-effort idempotent; mirroring never throws into the caller.
 */
@Injectable()
export class MagicLinkService extends createPrismaBase(MODELS.MagicLink) {
  constructor(private readonly crm: CrmUsersService) {
    super()
  }

  /**
   * Records (or re-records, on resend) that a link was sent to a lead. Upserts
   * on (userId, kind) so a resend overwrites the URL/expiry while preserving
   * any redeemed/onboarding progress already captured — and so a send down the
   * OTHER funnel creates its own row instead of overwriting this one.
   *
   * The slug rotates with the URL, so a resend retires the previously texted
   * short link rather than leaving two live entry points to one ticket.
   */
  async recordSent(args: {
    userId: number
    email: string
    url: string
    expiresAt: Date
    kind?: MagicLinkKind
  }): Promise<MagicLink> {
    const kind = args.kind ?? MagicLinkKind.SERVE
    const sentAt = new Date()
    const slug = nanoid(SLUG_LENGTH)
    const record = await this.model.upsert({
      where: { userId_kind: { userId: args.userId, kind } },
      create: {
        userId: args.userId,
        email: args.email,
        url: args.url,
        slug,
        sentAt,
        expiresAt: args.expiresAt,
        kind,
      },
      update: {
        email: args.email,
        url: args.url,
        slug,
        sentAt,
        expiresAt: args.expiresAt,
        kind,
      },
    })
    await this.mirror(record)
    return record
  }

  /**
   * Resolves a short-link slug for the public /s/<slug> redirect. Returns the
   * row regardless of status; the caller gates on `computeMagicLinkStatus` so a
   * consumed or expired ticket is never handed back out.
   */
  getBySlug(slug: string): Promise<MagicLink | null> {
    return this.model.findUnique({ where: { slug } })
  }

  /**
   * The lead's magic link for one funnel. `kind` is required rather than
   * defaulted: a lead may hold both a SERVE and a WIN link, and picking one
   * silently is how the caller ends up texting or redeeming the wrong funnel's
   * link.
   */
  getByUserId(userId: number, kind: MagicLinkKind): Promise<MagicLink | null> {
    return this.model.findUnique({ where: { userId_kind: { userId, kind } } })
  }

  /**
   * Looks up a lead's magic link for one funnel, by email (case-insensitive).
   * Used by the sales card to fetch the redemption URL on demand — the URL is
   * never mirrored to HubSpot, so this is the only way to retrieve it for the
   * "copy link" action.
   *
   * `kind` is required for the same reason it is on getByUserId, and the reason
   * is sharper here. While userId was unique there was at most one row per
   * lead, so an unscoped `findFirst` was unambiguous. Now that a lead can hold
   * both, the newest row wins — and the serve card would text or copy the win
   * link whenever the rep happened to mint that one second.
   */
  getByEmail(email: string, kind: MagicLinkKind): Promise<MagicLink | null> {
    return this.model.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, kind },
      orderBy: { createdAt: 'desc' },
    })
  }

  /**
   * Records that the link was texted. Deliberately does not touch the lifecycle
   * timestamps or re-mirror to HubSpot — delivery metadata is for our own
   * tracing, and `sentAt`/`status` already read the same whether the link went
   * out by email or SMS.
   */
  recordSmsSent(args: {
    userId: number
    kind: MagicLinkKind
    phone: string
    messageId: string | null
  }): Promise<MagicLink> {
    return this.model.update({
      where: { userId_kind: { userId: args.userId, kind: args.kind } },
      data: {
        phone: args.phone,
        smsSentAt: new Date(),
        smsMessageId: args.messageId,
      },
    })
  }

  /**
   * Marks this funnel's link redeemed (once). No-op if absent or already set.
   * The caller passes the funnel it is completing, so redeeming a SERVE link
   * never clears the lead's separate WIN link.
   */
  async markRedeemed(
    userId: number,
    kind: MagicLinkKind,
  ): Promise<MagicLink | null> {
    const where = { userId_kind: { userId, kind } }
    const existing = await this.model.findUnique({ where })
    if (!existing || existing.redeemedAt) return existing ?? null
    const record = await this.model.update({
      where,
      data: { redeemedAt: new Date() },
    })
    await this.mirror(record)
    return record
  }

  /** Marks this funnel's onboarding complete (once). No-op if absent or set. */
  async markOnboardingCompleted(
    userId: number,
    kind: MagicLinkKind,
  ): Promise<MagicLink | null> {
    const where = { userId_kind: { userId, kind } }
    const existing = await this.model.findUnique({ where })
    if (!existing || existing.onboardingCompletedAt) return existing ?? null
    const record = await this.model.update({
      where,
      data: { onboardingCompletedAt: new Date() },
    })
    await this.mirror(record)
    return record
  }

  /**
   * Mirrors the record's derived status onto the lead's HubSpot contact.
   * Best-effort: a mirror failure logs and returns without throwing, so the
   * gp-db source of truth stays authoritative and a later transition (or
   * backfill) can reconcile.
   */
  private async mirror(record: MagicLink): Promise<void> {
    try {
      const contactId = await this.crm.syncMagicLinkContactProperties(record)
      if (contactId && contactId !== record.crmContactId) {
        await this.model
          .update({
            where: { id: record.id },
            data: { crmContactId: contactId },
          })
          .catch((err: unknown) => {
            this.logger.warn(
              { err, userId: record.userId },
              'Failed to cache resolved CRM contact id on magic link',
            )
          })
      }
    } catch (err) {
      this.logger.warn(
        { err, userId: record.userId },
        'Failed to mirror magic-link state to HubSpot',
      )
    }
  }
}
