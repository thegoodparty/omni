import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'

@Injectable()
export class PeerlyPhoneListCaptureService extends createPrismaBase(
  MODELS.PeerlyPhoneList,
) {
  // Writes the parent capture row and its recipient rows together so a list
  // Peerly never received can never gain capture rows — callers only invoke
  // this after the Peerly upload has already succeeded.
  async recordUpload(params: {
    organizationSlug: string
    campaignId: number
    token: string
    voterFileFilterId: number | null
    recipients: { personId: string; phone: string }[]
    excludedOptedOutCount: number
    excludedDuplicatePhoneCount: number
  }): Promise<void> {
    const {
      organizationSlug,
      campaignId,
      token,
      voterFileFilterId,
      recipients,
      excludedOptedOutCount,
      excludedDuplicatePhoneCount,
    } = params

    await this.client.$transaction(async (tx) => {
      const phoneList = await tx.peerlyPhoneList.create({
        data: {
          organizationSlug,
          campaignId,
          token,
          voterFileFilterId,
          excludedOptedOutCount,
          excludedDuplicatePhoneCount,
        },
      })
      await tx.peerlyPhoneListRecipient.createMany({
        data: recipients.map(({ personId, phone }) => ({
          peerlyPhoneListId: phoneList.id,
          personId,
          phone,
        })),
      })
    })
  }

  // Stamps the numeric Peerly list id the first time the status endpoint
  // reports the list ready. Guarded on peerlyListId IS NULL so a repeat poll
  // after the first success is a no-op rather than a re-write.
  async stampPeerlyListId(token: string, peerlyListId: number): Promise<void> {
    await this.model.updateMany({
      where: { token, peerlyListId: null },
      data: { peerlyListId },
    })
  }

  // Recipients live on a sibling model to the one this service extends, so
  // they're read via `client` rather than the inherited `findMany`. Ordered
  // by id so skip/take pagination is stable across calls (unordered
  // findMany offers no such guarantee).
  findRecipientsPage(
    peerlyPhoneListId: string,
    params: { skip: number; take: number },
  ): Promise<{ personId: string }[]> {
    return this.client.peerlyPhoneListRecipient.findMany({
      where: { peerlyPhoneListId },
      select: { personId: true },
      orderBy: { id: 'asc' },
      skip: params.skip,
      take: params.take,
    })
  }

  // The inbound sweep matches vendor-reported phones against the whole
  // captured list at once; lists are bounded by the upload cap, so one
  // unpaged read is fine.
  findRecipientsWithPhones(
    peerlyPhoneListId: string,
  ): Promise<{ personId: string; phone: string }[]> {
    return this.client.peerlyPhoneListRecipient.findMany({
      where: { peerlyPhoneListId },
      select: { personId: true, phone: true },
    })
  }
}
