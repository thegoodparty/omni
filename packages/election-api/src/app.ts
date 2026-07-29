import { HttpAdapterHost, NestFactory } from '@nestjs/core'
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import { AppModule } from './app.module'
import { Logger as PinoNestLogger, PinoLogger } from 'nestjs-pino'
import { AllExceptionsFilter } from './shared/filters/allExceptions.filter'
import fastifyStatic from '@fastify/static'
import { join } from 'path'
import { ZodValidationPipe } from 'nestjs-zod'
import { randomUUID } from 'crypto'

type BootstrapParams = {
  // Tests boot the same app but silence the Nest logger to keep output clean.
  loggingEnabled?: boolean
}

/**
 * Builds the fully-wired Nest Fastify application (global prefix, validation
 * pipe, exception filter, helmet, cors, static assets) WITHOUT calling
 * `listen`. Production entry (`main.ts`) and the integration test harness
 * (`test-service.ts`) share this so tests exercise the exact same middleware
 * stack — including the PII `omit` behaviour and Zod validation — as prod.
 */
export const bootstrap = async ({
  loggingEnabled = true,
}: BootstrapParams = {}): Promise<NestFastifyApplication> => {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false, genReqId: () => randomUUID() }),
    {
      rawBody: true,
      bufferLogs: true,
    },
  )
  app.useLogger(loggingEnabled ? app.get(PinoNestLogger) : false)

  if (global.__fastifyOtelInstrumentation) {
    await app
      .getHttpAdapter()
      .getInstance()
      .register(global.__fastifyOtelInstrumentation.plugin())
  }

  app.setGlobalPrefix('v1')
  app.useGlobalPipes(new ZodValidationPipe())

  const httpAdapterHost = app.get(HttpAdapterHost)
  const logger = await app.resolve(PinoLogger)
  app.useGlobalFilters(
    new AllExceptionsFilter(httpAdapterHost.httpAdapter, logger),
  )

  const swaggerConfig = new DocumentBuilder()
    .setTitle('API Documentation')
    .setDescription('The API description')
    .setVersion('1.0')
    .build()

  const document = SwaggerModule.createDocument(app, swaggerConfig)
  SwaggerModule.setup('api', app, document)

  await app.register(helmet)

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  })

  await app.register(fastifyStatic, {
    root: join(__dirname, '..', 'public'),
    prefix: '/public/',
  })

  return app
}
