import { ConflictException, Injectable } from '@nestjs/common'
import { chunk } from 'es-toolkit'
import { Readable } from 'stream'
import { EmailRecipientUploadResponse } from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { OutreachStatus } from '../../generated/prisma'
import { EmailSendScope } from '../emailOutreach.types'
import { capName, emailDomain, normalizeEmail } from '../util/emailAddress.util'
import { parseRecipientCsv } from '../util/emailCsv.util'
import { EmailDomainCheckService } from './emailDomainCheck.service'
import { OutreachEmailService } from './outreachEmail.service'

const SUPPRESSION_LOOKUP_CHUNK = 1000
const REPLACE_TRANSACTION_TIMEOUT_MS = 30_000

type Candidate = {
  email: string
  firstName: string | null
  lastName: string | null
}

@Injectable()
export class OutreachEmailRecipientService extends createPrismaBase(
  MODELS.OutreachEmailRecipient,
) {
  constructor(
    private readonly emails: OutreachEmailService,
    private readonly domainCheck: EmailDomainCheckService,
  ) {
    super()
  }

  async replaceFromCsv(
    scope: EmailSendScope,
    outreachId: number,
    file: Buffer | Readable,
    userId: number,
  ): Promise<EmailRecipientUploadResponse> {
    const draft = await this.emails.findDraftOrThrow(scope, outreachId)
    if (draft.outreach.status !== OutreachStatus.draft) {
      throw new ConflictException('Recipients can only change on a draft')
    }

    const rows = await parseRecipientCsv(file)

    let invalid = 0
    let duplicate = 0
    const seen = new Set<string>()
    const candidates: Candidate[] = []
    for (const row of rows) {
      const email = normalizeEmail(row.email)
      if (!email) {
        invalid++
      } else if (seen.has(email)) {
        duplicate++
      } else {
        seen.add(email)
        candidates.push({
          email,
          firstName: capName(row.firstName),
          lastName: capName(row.lastName),
        })
      }
    }

    const badDomains = await this.domainCheck.findUndeliverableDomains(
      candidates.map((c) => emailDomain(c.email)),
    )
    const deliverable = candidates.filter((c) => {
      const ok = !badDomains.has(emailDomain(c.email))
      if (!ok) invalid++
      return ok
    })

    const unsubscribed = await this.findUnsubscribed(
      scope.suppressionSlugs,
      deliverable.map((c) => c.email),
    )
    const ready = deliverable.filter((c) => !unsubscribed.has(c.email))

    await this.client.$transaction(
      async (tx) => {
        const claim = await tx.outreach.updateMany({
          where: { id: outreachId, status: OutreachStatus.draft },
          data: { updatedAt: new Date() },
        })
        if (claim.count === 0) {
          throw new ConflictException('Recipients can only change on a draft')
        }
        await tx.outreachEmailRecipient.deleteMany({
          where: { outreachEmailId: draft.id },
        })
        await tx.outreachEmailRecipient.createMany({
          data: ready.map((c) => ({
            outreachEmailId: draft.id,
            senderId: draft.senderId,
            ...c,
          })),
        })
        await tx.outreachEmail.update({
          where: { id: draft.id },
          data: {
            consentConfirmedAt: new Date(),
            consentConfirmedByUserId: userId,
          },
        })
      },
      { timeout: REPLACE_TRANSACTION_TIMEOUT_MS },
    )

    return {
      ready: ready.length,
      invalid,
      duplicate,
      unsubscribed: deliverable.length - ready.length,
    }
  }

  private async findUnsubscribed(
    organizationSlugs: string[],
    emails: string[],
  ): Promise<Set<string>> {
    const found = new Set<string>()
    for (const batch of chunk(emails, SUPPRESSION_LOOKUP_CHUNK)) {
      const rows = await this.client.outreachEmailSuppression.findMany({
        where: {
          organizationSlug: { in: organizationSlugs },
          revokedAt: null,
          email: { in: batch },
        },
        select: { email: true },
      })
      rows.forEach((row) => found.add(row.email))
    }
    return found
  }
}
