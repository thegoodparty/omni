import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { ElectedOfficeService } from 'src/electedOffice/services/electedOffice.service'
import { isUniqueConstraintError } from 'src/prisma/util/prismaErrors.util'
import { PurchaseHandler } from 'src/payments/purchase.types'
import { calcTextAmountInCents } from 'src/shared/util/textPricing.util'
import { UsersService } from 'src/users/services/users.service'
import { version as uuidVersion } from 'uuid'
import z from 'zod'
import { PollsService } from './polls.service'
import { MAX_POLL_MESSAGE_LENGTH } from '../schemas/poll.schema'
import { PinoLogger } from 'nestjs-pino'

const MAX_CONSTITUENTS_PER_RUN = 10000

const uuidV7Schema = z.string().refine(
  (value) => {
    try {
      return uuidVersion(value) === 7
    } catch {
      return false
    }
  },
  {
    message: 'Invalid UUIDv7',
  },
)

enum PollPurchaseType {
  new = 'new',
  expansion = 'expansion',
}

const PollPurchaseMetadataSchema = z.union([
  z.object({
    pollPurchaseType: z.literal(PollPurchaseType.new),
    pollId: uuidV7Schema,
    name: z.string().min(1).max(100),
    message: z.string().min(1).max(MAX_POLL_MESSAGE_LENGTH),
    imageUrl: z.string().url().nullable().default(null),
    audienceSize: z.coerce.number().int().min(1).max(MAX_CONSTITUENTS_PER_RUN),
    scheduledDate: z.string().datetime(),
  }),
  z.object({
    pollPurchaseType: z
      .literal(PollPurchaseType.expansion)
      .optional()
      .default(PollPurchaseType.expansion),
    pollId: uuidV7Schema,
    count: z.coerce.number().int().min(1).max(MAX_CONSTITUENTS_PER_RUN),
    scheduledDate: z.string().datetime().optional(),
  }),
])

@Injectable()
export class PollPurchaseHandlerService implements PurchaseHandler<unknown> {
  constructor(
    private readonly pollsService: PollsService,
    private readonly electedOfficeService: ElectedOfficeService,
    private readonly usersService: UsersService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PollPurchaseHandlerService.name)
  }

  async validatePurchase(rawMetadata: unknown): Promise<void> {
    const result = PollPurchaseMetadataSchema.safeParse(rawMetadata)
    if (!result.success) {
      throw new BadRequestException(result.error.message)
    }
  }

  async calculateAmount(rawMetadata: unknown): Promise<number> {
    const metadata = PollPurchaseMetadataSchema.parse(rawMetadata)

    return metadata.pollPurchaseType === PollPurchaseType.expansion
      ? calcTextAmountInCents(metadata.count)
      : calcTextAmountInCents(metadata.audienceSize)
  }

  async handlePollPostPurchase(
    sessionId: string,
    rawMetadata: unknown,
  ): Promise<void> {
    const metadata = PollPurchaseMetadataSchema.parse(rawMetadata)

    this.logger.info(
      { metadata },
      `Poll checkout session completed: sessionId=${sessionId} metadata=`,
    )

    // userId is set server-side from the authenticated purchaser by
    // createCustomCheckoutSession / completeFreePurchase, so it is the trusted
    // identity for this purchase. Both the new-poll and expansion paths scope to
    // the buyer's own elected office through it.
    // Stripe metadata typed as Metadata (Record<string, string>) — no generic parameterization
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const userId = (rawMetadata as Record<string, string>)?.userId
    if (!userId) {
      throw new BadRequestException('No userId found in session metadata')
    }

    const user = await this.usersService.findUser({ id: parseInt(userId) })
    if (!user) {
      throw new BadRequestException(`User not found: ${userId}`)
    }

    if (metadata.pollPurchaseType === PollPurchaseType.expansion) {
      return this.processExpansion(metadata, user.id)
    }

    return this.processNewPoll(metadata, user.id)
  }

  /**
   * Shared logic for expanding an existing poll with additional recipients.
   */
  private async processExpansion(
    metadata: z.infer<typeof PollPurchaseMetadataSchema> & {
      pollPurchaseType: PollPurchaseType.expansion
    },
    userId: number,
  ): Promise<void> {
    // Verify the poll belongs to the paying user's elected office before
    // mutating it. pollId comes from checkout metadata; without this check a
    // user could expand (and schedule texts on) another office's poll (IDOR),
    // matching the ensurePollAccess check the standard poll routes enforce.
    const electedOffice = await this.electedOfficeService.findFirst({
      where: { userId },
    })
    if (!electedOffice) {
      throw new BadRequestException(
        `Elected office not found for userId ${userId} poll ${metadata.pollId}`,
      )
    }

    const poll = await this.pollsService.findUnique({
      where: { id: metadata.pollId },
    })
    if (!poll) {
      throw new NotFoundException(`Poll not found: ${metadata.pollId}`)
    }
    if (poll.electedOfficeId !== electedOffice.id) {
      throw new ForbiddenException(
        'You do not have permission to expand this poll',
      )
    }

    await this.pollsService.expandPoll({
      pollId: metadata.pollId,
      additionalRecipientCount: metadata.count,
      scheduledDate: metadata.scheduledDate
        ? new Date(metadata.scheduledDate)
        : new Date(),
    })
  }

  /**
   * Shared logic for creating a new poll after purchase.
   */
  private async processNewPoll(
    metadata: z.infer<typeof PollPurchaseMetadataSchema> & {
      pollPurchaseType: PollPurchaseType.new
    },
    userId: number,
  ): Promise<void> {
    const electedOffice = await this.electedOfficeService.findFirst({
      where: { userId },
    })

    if (!electedOffice) {
      throw new BadRequestException(
        `Elected office not found for userId ${userId} poll ${metadata.pollId}`,
      )
    }

    try {
      await this.pollsService.create({
        id: metadata.pollId,
        name: metadata.name,
        electedOfficeId: electedOffice.id,
        messageContent: metadata.message,
        imageUrl: metadata.imageUrl,
        targetAudienceSize: metadata.audienceSize,
        scheduledDate: metadata.scheduledDate,
      })
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error
      }
      await this.reconcileDuplicatePollCreate(metadata.pollId, electedOffice.id)
    }
  }

  // P2002 here is always the poll primary key: `poll` has no other unique
  // constraint (see prisma/schema/poll.prisma — @@index([electedOfficeId, id])
  // is a plain index), and the id is not a sequence that could hand out a
  // taken value. Migration 20251009163918_polls_new_pk retyped poll.id from
  // SERIAL to TEXT and ran DROP SEQUENCE "Poll_id_seq", so every id the
  // application writes is supplied explicitly. On this path it is
  // metadata.pollId, minted in the browser at CreatePoll.tsx (useState(uuidv7))
  // and carried through Stripe checkout metadata — the same value for every
  // fulfillment attempt of the same checkout.
  //
  // So a duplicate is not a collision, it is the same purchase being fulfilled
  // twice, which this pipeline actively invites:
  //   - completeCheckoutSession in payments/services/purchase.service.ts
  //     documents its own race — it reads postPurchaseCompletedAt off the
  //     PaymentIntent and writes it only after the handler returns, so two
  //     callers that both read before either writes both run the handler. The
  //     two callers race by construction: the Stripe webhook
  //     (checkout.session.completed) and the browser calling
  //     completeCheckoutSession from PollPayment.tsx on redirect, both within
  //     the same second or so of payment.
  //   - Stripe webhook delivery is at-least-once and retries on any non-2xx.
  //     The marker is written after the handler by design ("to allow retries on
  //     failure"), so any failure downstream of the insert — in the same
  //     handler or in the webhook plumbing above it — brings the redelivery
  //     back through this create with the row already committed.
  // That docstring's own prescription is that handlers implement their own
  // idempotency by checking for existing records; the poll handler was the one
  // that never did, so the loser of the race 500'd instead of no-opping.
  //
  // Deliberately catch-and-reconcile rather than a findUnique pre-check: a
  // pre-check reproduces exactly the read-then-write window that causes this,
  // whereas the primary key settles it in the database. This matches the
  // established idiom here (raceOpponent/services/contrastEngine.service.ts,
  // campaignStory/services/campaignStory.service.ts).
  private async reconcileDuplicatePollCreate(
    pollId: string,
    electedOfficeId: string,
  ): Promise<void> {
    const existing = await this.pollsService.findUnique({
      where: { id: pollId },
    })

    if (!existing) {
      // The row was there a moment ago (that is what P2002 means) and is gone
      // now — a delete landed in between. Nothing was fulfilled, so refuse to
      // report success: rethrowing a non-BadRequest lets the webhook surface it
      // and Stripe redeliver, and the next attempt inserts cleanly.
      throw new ConflictException(
        `Poll ${pollId} conflicted on create but could not be re-read`,
      )
    }

    if (existing.electedOfficeId !== electedOfficeId) {
      // pollId is client-supplied, so it can in principle name a poll belonging
      // to someone else. Treating that as "already fulfilled" would take the
      // buyer's money and silently hand them nothing, and would hide the
      // collision. Nothing of the other office's is read or written here — the
      // expansion path above refuses the mirror-image case with Forbidden.
      //
      // BadRequestException specifically, not Forbidden: the webhook caller in
      // payments/services/paymentEventsService.ts treats BadRequest as a
      // permanent content rejection and acknowledges it, while anything else is
      // rethrown and redelivered by Stripe for days. A client-chosen id that
      // belongs to another office is identical on every redelivery, so retrying
      // it forever buys nothing and buries the signal.
      this.logger.error(
        {
          pollId,
          electedOfficeId,
          ownerElectedOfficeId: existing.electedOfficeId,
        },
        'Poll purchase supplied a pollId owned by a different elected office',
      )
      throw new BadRequestException(
        `Poll ${pollId} already exists and belongs to another elected office`,
      )
    }

    // Same buyer, same poll: the first fulfillment already created it. Return
    // normally so completeCheckoutSession stamps postPurchaseCompletedAt and
    // the redeliveries stop.
    //
    // Note what this does NOT do: it does not re-send the POLL_CREATION queue
    // message. PollsService.create sends it with the default
    // throwOnError: false (queue/producer/queueProducer.service.ts), so the
    // winning insert's send is best-effort and already either happened or was
    // logged and swallowed — a send here could only duplicate it, and the
    // producer defaults deduplicationId to a fresh random string, so SQS FIFO
    // would not collapse the duplicate. Duplicate POLL_CREATION means texting
    // constituents twice and paying for it, which is strictly worse than the
    // pre-existing best-effort gap this leaves in place.
    this.logger.info(
      { pollId, electedOfficeId },
      'Poll already created for this purchase; skipping duplicate fulfillment',
    )
  }
}
