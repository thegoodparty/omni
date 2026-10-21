import { PublicAccess } from '@/authentication/decorators/PublicAccess.decorator'
import { VENDOR_MODE } from '@/shared/util/appEnvironment.util'
import { SUPPORTED_TLDS } from '@/websites/domains.types'
import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Header,
  NotFoundException,
  Post,
} from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { FastifyInstance } from 'fastify'
import { PinoLogger } from 'nestjs-pino'

const AWS_JSON_CONTENT_TYPE = 'application/x-amz-json-1.1'
const TARGET_PREFIX = 'Route53Domains_v20140515.'
const TAKEN_PREFIX = 'taken-'
const SUGGESTION_COUNT = 3
const MOCK_PRICE_USD = 13

type JsonBody = Record<string, unknown>

const price = () => ({ Price: MOCK_PRICE_USD, Currency: 'USD' })

const priceEntry = (tld: string) => ({
  Name: tld,
  RegistrationPrice: price(),
  RenewalPrice: price(),
  TransferPrice: price(),
  ChangeOwnershipPrice: price(),
  RestorationPrice: price(),
})

// AWS JSON 1.1 clients (SDK v3) post to `/` with content-type
// application/x-amz-json-1.1, which Fastify has no parser for (it would 415).
@Controller('vendor-mocks/route53')
@PublicAccess()
export class Route53MockController {
  constructor(
    private readonly logger: PinoLogger,
    httpAdapterHost: HttpAdapterHost,
  ) {
    this.logger.setContext(Route53MockController.name)
    const fastify = httpAdapterHost.httpAdapter.getInstance<FastifyInstance>()
    if (!fastify.hasContentTypeParser(AWS_JSON_CONTENT_TYPE)) {
      fastify.addContentTypeParser(
        AWS_JSON_CONTENT_TYPE,
        { parseAs: 'string' },
        (_req, body, done) => {
          const text = typeof body === 'string' ? body : body.toString()
          if (!text) return done(null, {})
          try {
            done(null, JSON.parse(text))
          } catch {
            const err = new BadRequestException({
              __type: 'InvalidInput',
              message: 'Malformed JSON body',
            })
            done(err, undefined)
          }
        },
      )
    }
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', AWS_JSON_CONTENT_TYPE)
  handleOperation(
    @Headers('x-amz-target') target: string | undefined,
    @Body() body: JsonBody | undefined,
  ) {
    this.assertMockMode()
    const input = body && typeof body === 'object' ? body : {}

    switch (target) {
      case `${TARGET_PREFIX}CheckDomainAvailability`: {
        const domain = this.requireString(input, 'DomainName')
        return {
          Availability: domain.startsWith(TAKEN_PREFIX)
            ? 'UNAVAILABLE'
            : 'AVAILABLE',
        }
      }
      case `${TARGET_PREFIX}GetDomainSuggestions`: {
        const domain = this.requireString(input, 'DomainName')
        const dot = domain.indexOf('.')
        const sld = dot === -1 ? domain : domain.slice(0, dot)
        const tld = dot === -1 ? 'com' : domain.slice(dot + 1)
        return {
          SuggestionsList: ['get', 'vote', 'team']
            .slice(0, SUGGESTION_COUNT)
            .map((prefix) => ({
              DomainName: `${prefix}${sld}.${tld}`,
              Availability: 'AVAILABLE',
            })),
        }
      }
      case `${TARGET_PREFIX}ListPrices`: {
        const filter =
          typeof input.Tld === 'string'
            ? input.Tld.replace(/^\./, '')
            : undefined
        const tlds = ['com', ...SUPPORTED_TLDS].filter(
          (t) => !filter || t === filter,
        )
        return { Prices: tlds.map(priceEntry) }
      }
      default:
        this.logger.warn({ target }, 'Route53 mock: unsupported X-Amz-Target')
        throw new HttpException(
          { __type: 'NotImplemented', message: `Unsupported target ${target}` },
          HttpStatus.NOT_IMPLEMENTED,
        )
    }
  }

  private assertMockMode() {
    if (VENDOR_MODE !== 'mock') throw new NotFoundException()
  }

  // 4xx on bad input: the client retries 5xx up to 8 times.
  private requireString(input: JsonBody, key: string): string {
    const value = input[key]
    if (typeof value !== 'string' || !value) {
      throw new BadRequestException({
        __type: 'InvalidInput',
        message: `${key} is required`,
      })
    }
    return value
  }
}
