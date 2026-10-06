import { ConflictException } from '@nestjs/common'
import {
  OutreachStatus,
  OutreachType,
  Prisma,
  type PrismaClient,
} from '../../generated/prisma'

// A text holds its card's key from its unpaid draft on, so these read as the
// proposal not sent yet. Win's build-mode `draft` has not been paid for
// either.
export const UNSENT_PROPOSAL_STATUSES: OutreachStatus[] = [
  OutreachStatus.pending_payment,
  OutreachStatus.draft,
]

/**
 * A text draft from a chat card carries the card's key. Going back from
 * review or abandoning checkout leaves an unpaid draft holding it, and
 * re-entering makes a fresh draft, so the key moves to the new one. Once a
 * draft under the key is paid for, the proposal has been sent.
 *
 * `create` writes the row with the key in its INSERT; `load` reads back the
 * unpaid draft that won a race on the unique index, in the caller's shape.
 */
export const createUnderProposalKey = async <T>(
  client: Pick<PrismaClient, '$transaction' | 'outreach'>,
  args: {
    proposalKey: string
    organizationSlug: string
    outreachType: OutreachType
  },
  create: (tx: Prisma.TransactionClient) => Promise<T>,
  load: (id: number) => Promise<T>,
): Promise<T> => {
  const { proposalKey, organizationSlug, outreachType } = args
  const holderOf = (c: Pick<Prisma.TransactionClient, 'outreach'>) =>
    c.outreach.findUnique({
      where: { proposalKey },
      select: {
        id: true,
        organizationSlug: true,
        outreachType: true,
        status: true,
      },
    })
  type Holder = NonNullable<Awaited<ReturnType<typeof holderOf>>>
  // Another org's key, or another channel's, is not this proposal's text.
  // This org's text past checkout is the proposal already sent.
  const refusalFor = (holder: Holder): ConflictException | null =>
    holder.organizationSlug !== organizationSlug ||
    holder.outreachType !== outreachType
      ? new ConflictException('Proposal key is already in use')
      : !UNSENT_PROPOSAL_STATUSES.some((status) => status === holder.status)
        ? new ConflictException('This proposal has already been sent')
        : null

  return client
    .$transaction(async (tx) => {
      const holder = await holderOf(tx)
      if (holder) {
        const refusal = refusalFor(holder)
        if (refusal) throw refusal
        await tx.outreach.update({
          where: { id: holder.id },
          data: { proposalKey: null },
        })
      }
      return create(tx)
    })
    .catch(async (err: Error) => {
      // Two taps raced past the read above and the unique index let one
      // through. Its unpaid draft is the one this tap wanted, so hand it
      // back the way a first create would.
      if (
        !(err instanceof Prisma.PrismaClientKnownRequestError) ||
        err.code !== 'P2002'
      ) {
        throw err
      }
      const winner = await holderOf(client)
      if (!winner) throw err
      const refusal = refusalFor(winner)
      if (refusal) throw refusal
      return load(winner.id)
    })
}
