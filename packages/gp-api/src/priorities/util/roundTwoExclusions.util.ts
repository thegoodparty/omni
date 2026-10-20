import { OutreachStatus, type PrismaClient } from '../../generated/prisma'

type ExclusionClient = Pick<
  PrismaClient,
  | 'outreach'
  | 'outreachTextRecipient'
  | 'contactInteractionText'
  | 'contactInteractionPhoneBanking'
  | 'contactInteractionDoorKnock'
  | 'voterFileFilterSampleMember'
>

// Who a priority's round 2 text must not reach: everyone its other sends
// texted, called, knocked or drew, and everyone opted out of the office's
// texts (read by the caller through the capped
// `ContactInteractionTextService.findOptedOutPersonIds`). The create counts
// its pool without them and the draw leaves them out, so the two agree on
// who is left.
export const roundTwoExclusions = async (
  client: ExclusionClient,
  organizationSlug: string,
  priorityId: string,
  optedOutPersonIds: string[],
  roundTwoOutreachId?: number,
): Promise<string[]> => {
  const sends = await client.outreach.findMany({
    where: {
      priorityId,
      organizationSlug,
      campaignId: null,
      status: {
        notIn: [
          OutreachStatus.pending_payment,
          OutreachStatus.draft,
          OutreachStatus.canceled,
        ],
      },
      ...(roundTwoOutreachId !== undefined && {
        id: { not: roundTwoOutreachId },
      }),
    },
    select: { id: true, phoneBankingListId: true },
  })
  const ids = sends.map((send) => send.id)
  const lists = sends.flatMap((send) => send.phoneBankingListId ?? [])
  const person = { personId: true } as const
  const rows = await Promise.all([
    client.outreachTextRecipient.findMany({
      where: { outreachId: { in: ids } },
      select: person,
    }),
    client.contactInteractionText.findMany({
      where: { outreachId: { in: ids } },
      select: person,
    }),
    client.contactInteractionPhoneBanking.findMany({
      where: { phoneBankingListId: { in: lists } },
      select: person,
    }),
    client.contactInteractionDoorKnock.findMany({
      where: { organizationSlug, outreachId: { in: ids } },
      select: person,
    }),
    client.voterFileFilterSampleMember.findMany({
      where: {
        voterFileFilter: {
          organizationSlug,
          outreaches: { some: { id: { in: ids } } },
        },
      },
      select: person,
    }),
  ])
  return [
    ...new Set([
      ...rows.flat().map((row) => row.personId),
      ...optedOutPersonIds,
    ]),
  ]
}
