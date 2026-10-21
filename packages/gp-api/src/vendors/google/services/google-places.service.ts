import {
  Injectable,
  BadGatewayException,
  BadRequestException,
} from '@nestjs/common'
import { HttpService } from '@nestjs/axios'
import { GooglePlacesApiResponse } from '../../../shared/types/GooglePlaces.types'
import { firstValueFrom } from 'rxjs'
import { PinoLogger } from 'nestjs-pino'
import { resolveEnvVar } from '../../../shared/env/env'

const GOOGLE_NOT_CONFIGURED_MESSAGE =
  'Google services are disabled: set GOOGLE_API_KEY'

const googleApiKey = resolveEnvVar('GOOGLE_API_KEY')

@Injectable()
export class GooglePlacesService {
  constructor(
    private readonly httpService: HttpService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(GooglePlacesService.name)
    if (!googleApiKey.configured) {
      this.logger.warn(GOOGLE_NOT_CONFIGURED_MESSAGE)
    }
  }

  async getAddressByPlaceId(placeId: string): Promise<GooglePlacesApiResponse> {
    if (!googleApiKey.configured) {
      throw new BadRequestException(GOOGLE_NOT_CONFIGURED_MESSAGE)
    }
    const url = `https://maps.googleapis.com/maps/api/place/details/json`

    try {
      const response = await firstValueFrom(
        this.httpService.get<{
          status: string
          result: GooglePlacesApiResponse
        }>(url, {
          params: {
            place_id: placeId,
            key: googleApiKey.value,
          },
        }),
      )

      if (response.data.status !== 'OK') {
        throw new BadGatewayException(
          `Google Places API error: ${response.data.status}`,
        )
      }

      return response.data.result
    } catch (error) {
      console.error(error)
      throw new BadGatewayException(
        'Failed to fetch address from Google Places API',
      )
    }
  }
}
