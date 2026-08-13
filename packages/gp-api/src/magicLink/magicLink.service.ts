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
   * on the unique userId so a resend overwrites the URL/expiry while preserving
   * any redeemed/onboarding progress already captured.
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
      where: { userId: args.userId },
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

  /** The lead's single magic link (the userId column is unique). */
  getByUserId(userId: number): Promise<MagicLink | null> {
    return this.model.findUnique({ where: { userId } })
  }

  /**
   * Looks up a lead's magic link by email (case-insensitive). Used by the sales
   * card to fetch the redemption URL on demand — the URL is never mirrored to
   * HubSpot, so this is the only way to retrieve it for the "copy link" action.
   */
  getByEmail(email: string): Promise<MagicLink | null> {
    return this.model.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
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
    phone: string
    messageId: string | null
  }): Promise<MagicLink> {
    return this.model.update({
      where: { userId: args.userId },
      data: {
        phone: args.phone,
        smsSentAt: new Date(),
        smsMessageId: args.messageId,
      },
    })
  }

  /** Marks the lead's link redeemed (once). No-op if absent or already set. */
  async markRedeemed(userId: number): Promise<MagicLink | null> {
    const existing = await this.model.findUnique({ where: { userId } })
    if (!existing || existing.redeemedAt) return existing ?? null
    const record = await this.model.update({
      where: { userId },
      data: { redeemedAt: new Date() },
    })
    await this.mirror(record)
    return record
  }

  /** Marks onboarding complete (once). No-op if absent or already set. */
  async markOnboardingCompleted(userId: number): Promise<MagicLink | null> {
    const existing = await this.model.findUnique({ where: { userId } })
    if (!existing || existing.onboardingCompletedAt) return existing ?? null
    const record = await this.model.update({
      where: { userId },
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
