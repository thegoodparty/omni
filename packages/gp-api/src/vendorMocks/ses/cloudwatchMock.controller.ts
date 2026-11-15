import {
  BadRequestException,
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  NotFoundException,
  Post,
} from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { PublicAccess } from '@/authentication/decorators/PublicAccess.decorator'
import { VENDOR_MODE } from '@/shared/util/appEnvironment.util'
import { sesMockState } from './sesMockState'

const AWS_JSON_CONTENT_TYPE = 'application/x-amz-json-1.0'
const GET_METRIC_DATA = 'GraniteServiceVersion20100801.GetMetricData'

// Both rendering-failure spellings are queried; only one is counted.
const METRIC_KEYS = new Map<
  string,
  'send' | 'bounce' | 'complaint' | 'renderingFailure'
>([
  ['Send', 'send'],
  ['Bounce', 'bounce'],
  ['Complaint', 'complaint'],
  ['Rendering Failure', 'renderingFailure'],
])

const GetMetricDataSchema = z.object({
  MetricDataQueries: z.array(
    z.object({
      Id: z.string(),
      MetricStat: z.object({
        Metric: z.object({
          MetricName: z.string(),
          Dimensions: z.array(
            z.object({ Name: z.string(), Value: z.string() }),
          ),
        }),
      }),
    }),
  ),
})

// CloudWatch's SDK speaks AWS JSON 1.0 (a POST to `/` with an X-Amz-Target),
// which Fastify has no parser for. Only GetMetricData, answering from the SES
// mock's per-send numbers. Every query returns one summed datapoint.
@Controller('vendor-mocks/ses/cloudwatch')
@PublicAccess()
export class CloudwatchMockController {
  constructor(httpAdapterHost: HttpAdapterHost) {
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
            done(
              new BadRequestException({
                __type: 'InvalidParameterValue',
                message: 'Malformed JSON body',
              }),
              undefined,
            )
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
    @Body() body: Record<string, unknown> | undefined,
  ) {
    if (VENDOR_MODE !== 'mock') throw new NotFoundException()
    if (target !== GET_METRIC_DATA) {
      throw new HttpException(
        { __type: 'NotImplemented', message: `Unsupported target ${target}` },
        HttpStatus.NOT_IMPLEMENTED,
      )
    }
    const { MetricDataQueries } = GetMetricDataSchema.parse(body)
    const now = Math.floor(Date.now() / 1000)
    return {
      MetricDataResults: MetricDataQueries.map((query) => {
        const { MetricName, Dimensions } = query.MetricStat.Metric
        const tag = Dimensions.find((d) => d.Name === 'outreachEmailId')
        const key = METRIC_KEYS.get(MetricName)
        const value = tag && key ? sesMockState.metricsFor(tag.Value)[key] : 0
        return {
          Id: query.Id,
          Label: MetricName,
          StatusCode: 'Complete',
          Timestamps: value > 0 ? [now] : [],
          Values: value > 0 ? [value] : [],
        }
      }),
    }
  }
}
