import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  PHONE_BANKING_MAX_SHEET_COUNT,
  PHONE_BANKING_NAME_MAX_LENGTH,
  PHONE_BANKING_SHEET_SIZE,
  ServePhoneBankingCreateSchema,
} from '@goodparty_org/contracts'
import { OutreachService } from '@/outreach/services/outreach.service'
import { PhoneBankingListService } from '@/phoneBanking/services/phoneBankingList.service'
import { PrioritiesService } from '@/priorities/services/priorities.service'
import { ElectedOffice, Organization } from '../../generated/prisma'
import { SendOutreachProposalSchema } from '../schemas/sendOutreachProposal.schema'

// The sheets the frozen list prints on, derived from the audience the card
// already quoted rather than asked for: a proposal is a finished artifact, so
// a number the official would have to supply is only this arithmetic done by
// hand.
const sheetCountForAudience = (count: number): number =>
  Math.min(
    PHONE_BANKING_MAX_SHEET_COUNT,
    Math.max(1, Math.ceil(count / PHONE_BANKING_SHEET_SIZE)),
  )

@Injectable()
export class OutreachProposalService {
  constructor(
    private readonly outreach: OutreachService,
    private readonly phoneBankingLists: PhoneBankingListService,
    private readonly priorities: PrioritiesService,
  ) {}

  async send(
    organization: Organization,
    electedOffice: ElectedOffice,
    proposalKey: string,
    input: SendOutreachProposalSchema,
  ) {
    // Door knocking is drawn on a map, so its card carries a deep link and no
    // Send button. Reaching here means a request the card never offers.
    if (input.deepLinkOnly) {
      throw new BadRequestException(
        'This proposal is opened in its own flow, not sent from the chat',
      )
    }

    // Social carries no platforms, and a text lands unpaid behind checkout,
    // so neither can be completed from a card without choosing something the
    // official did not. Both render as deep links instead.
    if (input.channel !== 'phoneBanking') {
      throw new BadRequestException(
        `${input.channel} proposals are opened in their own flow, not sent ` +
          'from the chat',
      )
    }

    if (!input.savedFilterId) {
      throw new BadRequestException(
        'A proposal can only be sent against a saved list',
      )
    }

    // A priority belongs to one elected office, so the caller's own office is
    // the whole tenancy boundary — the body must not be able to hang this
    // send off someone else's.
    const priority = await this.priorities.findFirst({
      where: {
        id: input.priorityId,
        electedOfficeId: electedOffice.id,
        archivedAt: null,
      },
      select: { id: true },
    })
    if (!priority) {
      throw new NotFoundException('Priority not found')
    }

    // The schema POST /v1/phone-banking/serve/lists validates its body with.
    // Calling the service directly skips that route's pipe, and a proposal's
    // message and audience are unbounded strings its caps would never see.
    const parsed = ServePhoneBankingCreateSchema.safeParse({
      name: (input.listName ?? input.audience).slice(
        0,
        PHONE_BANKING_NAME_MAX_LENGTH,
      ),
      script: input.message,
      sheetCount: sheetCountForAudience(input.count),
      voterFileFilterId: input.savedFilterId,
      // A proposal is the official's own copy, which is what the shared
      // purpose vocabulary already calls 'custom'.
      purpose: 'custom',
    })
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues
          .map(
            (issue) =>
              `${issue.path.join('.') || 'proposal'}: ${issue.message}`,
          )
          .join('; '),
      )
    }

    return this.outreach.createWithProposalKey(
      proposalKey,
      electedOffice.organizationSlug,
      async () => {
        await this.phoneBankingLists.create(
          organization,
          {
            campaignId: null,
            organizationSlug: electedOffice.organizationSlug,
            proposalKey,
            priorityId: input.priorityId,
          },
          parsed.data,
        )
      },
    )
  }
}
