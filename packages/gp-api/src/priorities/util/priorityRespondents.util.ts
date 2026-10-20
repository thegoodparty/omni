import {
  OutreachStatus,
  OutreachType,
  PollIndividualMessageSender,
  type PrismaClient,
} from '../../generated/prisma'

type RespondentsClient = Pick<
  PrismaClient,
  | 'outreach'
  | 'pollIndividualMessage'
  | 'contactInteractionText'
  | 'contactInteractionPhoneBanking'
  | 'contactInteractionDoorKnock'
>

// A priority's sends are the ones past checkout.
export const PRIORITY_UNSENT_STATUSES: OutreachStatus[] = [
  OutreachStatus.pending_payment,
  OutreachStatus.draft,
  OutreachStatus.canceled,
]

// Who has answered a priority on any channel, each person once: a text
// reply that was more than STOP, an answered call or an answered door.
// Someone heard by text and at the door is one person. People who have
// opted out of the office's texts are left out, since this is who the
// priority's report back goes to.
export const answeredPersonIds = async (
  client: RespondentsClient,
  organizationSlug: string,
  priorityId: string,
): Promise<string[]> => {
  const sends = await client.outreach.findMany({
    where: {
      priorityId,
      organizationSlug,
      campaignId: null,
      status: { notIn: PRIORITY_UNSENT_STATUSES },
      outreachType: {
        in: [
          OutreachType.text,
          OutreachType.nativePhoneBanking,
          OutreachType.nativeDoorKnocking,
        ],
      },
    },
    select: { id: true, outreachType: true, phoneBankingListId: true },
  })
  const idsOf = (type: OutreachType): number[] =>
    sends.filter((send) => send.outreachType === type).map((send) => send.id)
  const phoneBankingListIds = sends.flatMap((send) =>
    send.outreachType === OutreachType.nativePhoneBanking &&
    send.phoneBankingListId !== null
      ? [send.phoneBankingListId]
      : [],
  )
  const [texts, calls, doors] = await Promise.all([
    client.pollIndividualMessage.findMany({
      where: {
        outreachId: { in: idsOf(OutreachType.text) },
        sender: PollIndividualMessageSender.CONSTITUENT,
        NOT: { isOptOut: true },
      },
      select: { personId: true },
      distinct: ['personId'],
    }),
    client.contactInteractionPhoneBanking.findMany({
      where: {
        phoneBankingListId: { in: phoneBankingListIds },
        outcome: 'answered',
      },
      select: { personId: true },
      distinct: ['personId'],
    }),
    client.contactInteractionDoorKnock.findMany({
      where: {
        organizationSlug,
        outreachId: { in: idsOf(OutreachType.nativeDoorKnocking) },
        outcome: 'answered',
      },
      select: { personId: true },
      distinct: ['personId'],
    }),
  ])
  const answered = [
    ...new Set([...texts, ...calls, ...doors].map(({ personId }) => personId)),
  ]
  if (answered.length === 0) return []
  const optedOut = await client.contactInteractionText.findMany({
    where: {
      organizationSlug,
      personId: { in: answered },
      optedOutAt: { not: null },
    },
    select: { personId: true },
    distinct: ['personId'],
  })
  const out = new Set(optedOut.map(({ personId }) => personId))
  return answered.filter((personId) => !out.has(personId))
}
