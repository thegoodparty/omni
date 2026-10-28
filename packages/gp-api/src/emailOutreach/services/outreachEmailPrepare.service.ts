import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { OutreachHoldState, OutreachStatus } from '../../generated/prisma'
import { renderOutreachEmail } from '../util/renderOutreachEmail.util'
import { SesService, sesTemplateNameFor, sesTenantNameFor } from './ses.service'

const PREPARE_TRANSACTION_TIMEOUT_MS = 60_000

@Injectable()
export class OutreachEmailPrepareService extends createPrismaBase(
  MODELS.OutreachEmail,
) {
  constructor(private readonly ses: SesService) {
    super()
  }

  // The emailSendPrepare step, run once a due send's hold is held: make sure
  // the organization's tenant exists, build the SES template, and trim the
  // recipients to the frozen cap. Every SES call tolerates "already exists"
  // and the database half commits once, so a redelivery is safe.
  async prepare(outreachEmailId: number): Promise<void> {
    const row = await this.model.findUnique({
      where: { id: outreachEmailId },
      include: {
        outreach: {
          select: { status: true, organizationSlug: true, campaignId: true },
        },
        sender: true,
      },
    })
    if (!row) {
      this.logger.warn({ outreachEmailId }, 'Prepare for a missing email send')
      return
    }
    if (
      row.preparedAt ||
      row.stoppingAt ||
      row.outreach.status !== OutreachStatus.in_progress
    ) {
      return
    }
    // The due sweep started this send on a held hold; if that changed before
    // prepare ran (a release, a capture by the expiry guard), it never sends.
    const hold = await this.client.outreachPaymentHold.findUnique({
      where: { outreachId: row.outreachId },
      select: { state: true },
    })
    if (hold?.state !== OutreachHoldState.held) {
      await this.client.outreach.updateMany({
        where: { id: row.outreachId, status: OutreachStatus.in_progress },
        data: {
          status: OutreachStatus.failed,
          error: `payment hold ${hold?.state ?? 'missing'}`,
        },
      })
      this.logger.warn(
        { outreachEmailId, holdState: hold?.state },
        'Email send failed at prepare: its hold is not held',
      )
      return
    }
    if (row.recipientCap === null) {
      throw new Error(`Email send ${outreachEmailId} has no recipient cap`)
    }

    const tenantName =
      row.sender.sesTenantName ?? sesTenantNameFor(row.sender.organizationSlug)
    if (!row.sender.sesTenantName) {
      await this.ses.ensureTenant(tenantName)
      await this.client.outreachEmailSender.updateMany({
        where: { id: row.senderId, sesTenantName: null },
        data: { sesTenantName: tenantName },
      })
    }

    const templateName = sesTemplateNameFor(row.id)
    await this.ses.createTemplate(
      tenantName,
      templateName,
      await renderOutreachEmail(row, row.sender.displayName),
    )

    const suppressionSlugs = await this.suppressionSlugsFor(
      row.outreach.organizationSlug,
      row.outreach.campaignId,
    )
    const cap = row.recipientCap
    await this.client.$transaction(
      async (tx) => {
        const locked = await tx.$queryRaw<{ prepared_at: Date | null }[]>`
          SELECT prepared_at FROM outreach_email
          WHERE id = ${row.id} FOR UPDATE
        `
        if (locked[0]?.prepared_at) return
        await tx.$executeRaw`
          DELETE FROM outreach_email_recipient r
          WHERE r.outreach_email_id = ${row.id}
            AND EXISTS (
              SELECT 1 FROM outreach_email_suppression s
              WHERE s.email = r.email
                AND s.organization_slug = ANY(${suppressionSlugs})
                AND s.revoked_at IS NULL
            )
        `
        // Never emailed by this sender first, then the longest ago, then
        // upload order (ids follow the file).
        await tx.$executeRaw`
          DELETE FROM outreach_email_recipient
          WHERE outreach_email_id = ${row.id}
            AND id NOT IN (
              SELECT r.id FROM outreach_email_recipient r
              LEFT JOIN LATERAL (
                SELECT MAX(p.sent_at) AS last_sent_at
                FROM outreach_email_recipient p
                WHERE p.sender_id = r.sender_id
                  AND p.email = r.email
                  AND p.sent_at IS NOT NULL
              ) history ON true
              WHERE r.outreach_email_id = ${row.id}
              ORDER BY history.last_sent_at ASC NULLS FIRST, r.id ASC
              LIMIT ${cap}
            )
        `
        await tx.outreachEmail.update({
          where: { id: row.id },
          data: { preparedAt: new Date(), sesTemplateName: templateName },
        })
      },
      { timeout: PREPARE_TRANSACTION_TIMEOUT_MS },
    )
  }

  // An office's sends also honor the unsubscribes of the campaign it came
  // from.
  async suppressionSlugsFor(
    organizationSlug: string | null,
    campaignId: number | null,
  ): Promise<string[]> {
    if (!organizationSlug) return []
    if (campaignId !== null) return [organizationSlug]
    const office = await this.client.electedOffice.findUnique({
      where: { organizationSlug },
      select: { campaign: { select: { organizationSlug: true } } },
    })
    return office?.campaign?.organizationSlug
      ? [organizationSlug, office.campaign.organizationSlug]
      : [organizationSlug]
  }
}
