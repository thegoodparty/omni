import { Injectable } from '@nestjs/common'
import {
  isEmailProfileUrl,
  type EmailContentDraft,
} from '@goodparty_org/contracts'
import { format } from 'date-fns'
import { PublicProfileAddressService } from '@/personProfiles/services/public-profile-address.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'

// The signature's "My public profile" link is the organization owner's
// public profile page, never what a client sent: gp-api fills it at save,
// preview, test send and prepare. Win and Serve resolve the same way, since
// both organizations are owned by the person whose page it is.
@Injectable()
export class OutreachEmailProfileService extends createPrismaBase(
  MODELS.Organization,
) {
  constructor(private readonly addresses: PublicProfileAddressService) {
    super()
  }

  // Empty when the content has no signature (no lookup at all), when the
  // owner has no live page, or when the page's address is not one an email
  // may link to (a local WEBAPP_ROOT_URL is plain http on localhost).
  // `requireResolved` is for prepare: the SES template is built once for
  // every recipient, so an election-api outage must fail the job (which
  // retries) instead of sending the whole email without the link.
  async withProfileUrl(
    organizationSlug: string,
    content: EmailContentDraft,
    { requireResolved = false }: { requireResolved?: boolean } = {},
  ): Promise<EmailContentDraft> {
    if (!content.blocks.some((block) => block.type === 'signature')) {
      return content
    }
    const profileUrl = await this.profileUrlFor(
      organizationSlug,
      requireResolved,
    )
    return {
      ...content,
      blocks: content.blocks.map((block) =>
        block.type === 'signature' ? { ...block, profileUrl } : block,
      ),
    }
  }

  private async profileUrlFor(
    organizationSlug: string,
    requireResolved: boolean,
  ): Promise<string> {
    const organization = await this.model.findUnique({
      where: { slug: organizationSlug },
      select: {
        owner: {
          select: {
            personProfile: {
              select: { personId: true, publishedAt: true, deletedAt: true },
            },
          },
        },
      },
    })
    const address = await this.addresses.resolve(
      organization?.owner.personProfile ?? null,
      format(new Date(), 'yyyy-MM-dd'),
    )
    if (requireResolved && address.status === 'unknown') {
      throw new Error(
        `Public profile address for organization ${organizationSlug} could not be resolved`,
      )
    }
    return address.status === 'live' && isEmailProfileUrl(address.url)
      ? address.url
      : ''
  }
}
