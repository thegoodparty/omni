import './configrc'
import { HttpAdapterHost, NestFactory } from '@nestjs/core'
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import helmet from '@fastify/helmet'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import websocket from '@fastify/websocket'
import { AppModule } from './app.module'
import { Logger as NestLogger } from '@nestjs/common'
import { Logger, PinoLogger } from 'nestjs-pino'
import fastifyStatic from '@fastify/static'
import { join } from 'path'
import cookie from '@fastify/cookie'
import { HttpExceptionFilter } from './exceptions/http-exception.filter'
import { PrismaExceptionFilter } from './exceptions/prisma-exception.filter'
import { randomUUID } from 'crypto'

type BootstrapParams = {
  loggingEnabled: boolean
}

export const bootstrap = async (
  params: BootstrapParams,
): Promise<NestFastifyApplication> => {
  const adapter = new FastifyAdapter({
    logger: false,
    genReqId: () => randomUUID(),
    // We run behind ALB / Vercel which terminate TLS and forward the real
    // client IP via `X-Forwarded-For`. Without `trustProxy`, `request.ip`
    // resolves to the upstream proxy's address, so any per-IP gate
    // (notably `BriefingsPdfRateLimitGuard` on the public PDF endpoint)
    // would key every user onto the same bucket. Fastify's `trustProxy`
    // tells it to honour the forwarded chain and surface the real client
    // IP on `request.ip`. Defaulting to `true` here is correct because we
    // only run this app behind known infrastructure that sets the header
    // honestly — never directly exposed to the internet.
    trustProxy: true,
  })

  /**
   * This hook copies the de-parameterized route path onto the raw request object.
   * This is used to populate the request.route property in the logger module.
   *
   * It must be registered before NestFactory.create() so that it fires
   * before the pino-http middleware that nestjs-pino sets up during init.
   */
  adapter.getInstance().addHook('onRequest', (req, _, done) => {
    req.raw.route = req.routeOptions?.url
    done()
  })

  await adapter.getInstance().register(websocket, {
    options: {
      maxPayload: 64 * 1024,
    },
  })

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    {
      rawBody: true,
      bufferLogs: true,
      abortOnError: false, // Don't abort immediately, show all errors
      logger: params.loggingEnabled
        ? ['log', 'error', 'warn', 'debug', 'verbose']
        : false,
    },
  )
  app.useLogger(app.get(Logger))

  if (global.__fastifyOtelInstrumentation) {
    await app
      .getHttpAdapter()
      .getInstance()
      .register(global.__fastifyOtelInstrumentation.plugin())
  }

  app.setGlobalPrefix('v1')

  const swaggerConfig = new DocumentBuilder()
    .setTitle('API Documentation')
    .setDescription('The API description')
    .setVersion('1.0')
    .build()

  // Do not expose the Swagger UI in production. It leaks the full API surface
  // and schema details. Keep it available in dev/qa (or when explicitly
  // enabled via SWAGGER_ENABLED). Treat an unset NODE_ENV as production-
  // equivalent so the gate stays fail-closed if the env is misconfigured.
  const swaggerEnabled =
    process.env.SWAGGER_ENABLED === 'true' ||
    (process.env.NODE_ENV !== undefined &&
      process.env.NODE_ENV !== 'production')
  if (swaggerEnabled) {
    const document = SwaggerModule.createDocument(app, swaggerConfig)
    SwaggerModule.setup('api', app, document)
  }

  await app.register(helmet)

  // Fail closed on CORS: `credentials: true` combined with a wildcard origin
  // is a fail-open combination, so we require an explicit CORS_ORIGIN allow
  // list at boot rather than defaulting to '*'. Mirrors the AUTH_SECRET boot
  // check in authentication.module.ts.
  if (!process.env.CORS_ORIGIN) {
    const msg =
      'CORS_ORIGIN is required for application startup (wildcard origin is not allowed with credentials)'
    new NestLogger('bootstrap').error(msg)
    throw new Error(msg)
  }
  const corsOrigin = process.env.CORS_ORIGIN.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  await app.register(cors, {
    origin: corsOrigin.length === 1 ? corsOrigin[0] : corsOrigin,
    credentials: true,
  })

  await app.register(fastifyStatic, {
    root: join(__dirname, '..', 'public'),
    prefix: '/public/',
  })

  await app.register(cookie, {
    secret: process.env.AUTH_SECRET,
  })

  await app.register(multipart, {
    limits: {
      // global default limits, can be overidden at handler level
      fields: 100, // Max number of non-file fields
      fileSize: 10_000_000, // For multipart forms, the max file size in bytes
      files: 1, // Max number of file fields
      parts: 100, // For multipart forms, the max number of parts (fields + files)
    },
  })

  const httpExceptionLogger = await app.resolve(PinoLogger)
  const prismaExceptionLogger = await app.resolve(PinoLogger)
  const httpAdapterHost = app.get(HttpAdapterHost)

  app.useGlobalFilters(
    new HttpExceptionFilter(httpExceptionLogger, httpAdapterHost),
    new PrismaExceptionFilter(prismaExceptionLogger),
  )
  app.enableShutdownHooks()

  return app
}
