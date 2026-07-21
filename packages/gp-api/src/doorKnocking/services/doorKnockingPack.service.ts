import { BadGatewayException, Injectable } from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { isAxiosError } from 'axios'
import * as jwt from 'jsonwebtoken'
import { lastValueFrom } from 'rxjs'
import { DoorKnockingPackRequest } from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { ContactsService } from '@/contacts/services/contacts.service'
import { Organization, Prisma } from '../../generated/prisma'
import { deriveKnockStatus } from '../utils/knockStatus.util'

const { PEOPLE_API_URL, PEOPLE_API_S2S_SECRET } = process.env
if (!PEOPLE_API_URL) {
  throw new Error('Please set PEOPLE_API_URL in your .env')
}
if (!PEOPLE_API_S2S_SECRET) {
  throw new Error('Please set PEOPLE_API_S2S_SECRET in your .env')
}

const TOKEN_TTL_SECONDS = 300
// A worst-city pack takes tens of seconds to build upstream.
const PACK_TIMEOUT_MS = 120_000

@Injectable()
export class DoorKnockingPackService extends createPrismaBase(
  MODELS.ContactInteractionDoorKnock,
) {
  constructor(
    private readonly httpService: HttpService,
    private readonly contacts: ContactsService,
  ) {
    super()
  }

  // The pack is a pass-through payload: people-api encodes the whole binary
  // (including the canvassStatus plane, from the statuses shipped in the
  // request), so gp-api never patches bytes — it only knows the org's knock
  // history.
  async build(organization: Organization): Promise<Buffer> {
    const districtId =
      await this.contacts.resolveEligibleDistrictId(organization)

    const interactions = await this.findMany({
      where: { organizationSlug: organization.slug },
      orderBy: [
        { occurredAt: Prisma.SortOrder.desc },
        { id: Prisma.SortOrder.desc },
      ],
      select: { personId: true, outcome: true, supportAnswer: true },
    })
    const knockStatuses: DoorKnockingPackRequest['knockStatuses'] = []
    const seen = new Set<string>()
    for (const interaction of interactions) {
      if (seen.has(interaction.personId)) continue
      seen.add(interaction.personId)
      knockStatuses.push({
        personId: interaction.personId,
        status: deriveKnockStatus(interaction),
      })
    }

    try {
      const response = await lastValueFrom(
        this.httpService.post<ArrayBuffer>(
          `${PEOPLE_API_URL}/v1/door-knocking/pack`,
          { districtId, knockStatuses },
          {
            headers: { Authorization: `Bearer ${this.s2sToken()}` },
            responseType: 'arraybuffer',
            timeout: PACK_TIMEOUT_MS,
          },
        ),
      )
      return Buffer.from(response.data)
    } catch (error) {
      this.logger.error(
        {
          status: isAxiosError(error) ? error.response?.status : undefined,
          message: error instanceof Error ? error.message : String(error),
        },
        'people-api pack build failed',
      )
      throw new BadGatewayException('Map data build failed')
    }
  }

  private s2sToken(): string {
    const now = Math.floor(Date.now() / 1000)
    return jwt.sign(
      {
        iss: 'gp-api',
        aud: 'people-api',
        iat: now,
        exp: now + TOKEN_TTL_SECONDS,
      },
      PEOPLE_API_S2S_SECRET!,
    )
  }
}
