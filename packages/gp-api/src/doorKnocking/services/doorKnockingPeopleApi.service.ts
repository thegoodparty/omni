import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { PinoLogger } from 'nestjs-pino'
import { isAxiosError } from 'axios'
import * as jwt from 'jsonwebtoken'
import { lastValueFrom } from 'rxjs'
import {
  Bbox,
  DoorKnockingEvaluateResponse,
  DoorKnockingEvaluateResponseSchema,
  DoorKnockingResidentsResponse,
  DoorKnockingResidentsResponseSchema,
} from '@goodparty_org/contracts'
import { FilterObject } from '@/contacts/utils/voterFileFilter.utils'
import { HttpStatus } from '@nestjs/common'

const { PEOPLE_API_URL, PEOPLE_API_S2S_SECRET } = process.env
if (!PEOPLE_API_URL) {
  throw new Error('Please set PEOPLE_API_URL in your .env')
}
if (!PEOPLE_API_S2S_SECRET) {
  throw new Error('Please set PEOPLE_API_S2S_SECRET in your .env')
}

const TOKEN_TTL_SECONDS = 300
const TOKEN_REFRESH_BUFFER_SECONDS = 60
// Sized from the 150-stop cap times observed voters-per-stop (~4 in dense
// cities) with generous headroom; people-api rejects (never truncates) past
// this, so an oversized polygon fails loudly.
const EVALUATE_MAX_PEOPLE = 20_000

// The S2S JWT mint duplicates ContactsService's private implementation —
// there is deliberately no shared helper yet (two callers); extract one if a
// third appears.
@Injectable()
export class DoorKnockingPeopleApiService {
  private cachedToken: string | null = null

  constructor(
    private readonly httpService: HttpService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(this.constructor.name)
  }

  private s2sToken(): string {
    if (this.cachedToken) {
      const decoded = jwt.decode(this.cachedToken)
      const exp =
        typeof decoded === 'object' && decoded !== null
          ? decoded.exp
          : undefined
      const now = Math.floor(Date.now() / 1000)
      if (exp && exp - now > TOKEN_REFRESH_BUFFER_SECONDS) {
        return this.cachedToken
      }
    }
    const now = Math.floor(Date.now() / 1000)
    this.cachedToken = jwt.sign(
      {
        iss: 'gp-api',
        aud: 'people-api',
        iat: now,
        exp: now + TOKEN_TTL_SECONDS,
      },
      PEOPLE_API_S2S_SECRET!,
    )
    return this.cachedToken
  }

  async evaluate(args: {
    districtId: string
    bbox: Bbox
    filters: FilterObject
  }): Promise<DoorKnockingEvaluateResponse> {
    try {
      const response = await lastValueFrom(
        this.httpService.post(
          `${PEOPLE_API_URL}/v1/door-knocking/evaluate`,
          {
            districtId: args.districtId,
            bbox: args.bbox,
            filters: args.filters,
            maxPeople: EVALUATE_MAX_PEOPLE,
          },
          { headers: { Authorization: `Bearer ${this.s2sToken()}` } },
        ),
      )
      return DoorKnockingEvaluateResponseSchema.parse(response.data)
    } catch (error) {
      // people-api 400s when the bbox exceeds maxPeople — that's the user's
      // polygon being too big, not an upstream failure.
      if (
        isAxiosError(error) &&
        error.response?.status === HttpStatus.BAD_REQUEST
      ) {
        throw new BadRequestException(
          'This turf matches too many voters — draw a smaller area or ' +
            'narrow the audience filters',
        )
      }
      // Never log the raw AxiosError: config.headers carries the S2S JWT.
      this.logger.error(
        {
          status: isAxiosError(error) ? error.response?.status : undefined,
          message: error instanceof Error ? error.message : String(error),
        },
        'people-api door-knocking evaluate failed',
      )
      throw new BadGatewayException('Turf evaluation failed')
    }
  }

  async residents(args: {
    districtId: string
    addressKeys: string[]
    targetPersonIds: string[]
  }): Promise<DoorKnockingResidentsResponse> {
    try {
      const response = await lastValueFrom(
        this.httpService.post(
          `${PEOPLE_API_URL}/v1/door-knocking/residents`,
          args,
          { headers: { Authorization: `Bearer ${this.s2sToken()}` } },
        ),
      )
      return DoorKnockingResidentsResponseSchema.parse(response.data)
    } catch (error) {
      // people-api 400s when residents exceed the per-route population cap
      // — a caller-visible contract violation, not an upstream failure.
      if (
        isAxiosError(error) &&
        error.response?.status === HttpStatus.BAD_REQUEST
      ) {
        throw new BadRequestException(
          'Residents lookup exceeded the expected population for this route',
        )
      }
      // Never log the raw AxiosError: config.headers carries the S2S JWT.
      this.logger.error(
        {
          status: isAxiosError(error) ? error.response?.status : undefined,
          message: error instanceof Error ? error.message : String(error),
        },
        'people-api door-knocking residents failed',
      )
      throw new BadGatewayException('Residents lookup failed')
    }
  }
}
