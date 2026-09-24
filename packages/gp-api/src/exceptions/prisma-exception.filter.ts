import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common'
import { Prisma } from '../generated/prisma'
import { PinoLogger } from 'nestjs-pino'

const prismaErrorClasses = [
  Prisma.PrismaClientKnownRequestError,
  Prisma.PrismaClientUnknownRequestError,
  Prisma.PrismaClientRustPanicError,
  Prisma.PrismaClientInitializationError,
  Prisma.PrismaClientValidationError,
]

/**
 * Which kind of Prisma error this is, by NAME rather than by `instanceof`.
 *
 * `prismaErrors.util.ts` documents the hazard: dual ESM/CJS resolution can load
 * the Prisma runtime twice, and an error thrown by one copy fails `instanceof`
 * against the other's class. Branching on `instanceof` would then let this
 * filter catch the error and classify none of it, falling through to the
 * `throw` at the bottom and straight back to Nest's default handler. Every
 * Prisma error class sets `name` to its own constructor name, so matching on
 * the name survives that.
 */
const isPrismaError = <T>(exception: unknown, name: string): exception is T =>
  typeof exception === 'object' &&
  exception !== null &&
  (exception as { name?: unknown }).name === name

// Prisma reports "the caller asked for something impossible" and "the database
// could not serve this right now" as the same class of error, and only the
// numeric code tells them apart. Guessing wrong toward 4xx is the expensive
// direction, because it is the silent one: EXCLUDED_STATUS_CODES in
// deploy/components/alerting/controller-alerts.ts drops 400s on purpose, so a
// server fault dressed as a bad request pages nobody, appears in no 5xx rate,
// and tells the caller not to bother retrying something a retry would fix.
//
// In the 30 days to 2026-09-16 that mapping hid 8,366 database faults, 2,147 of
// them in prod — almost all connection-pool exhaustion on GET
// /v1/public-campaigns and GET /v1/public-person-profiles.

/**
 * The codes where the CALLER is genuinely at fault, and what they should be
 * told. Anything absent from here is treated as our fault; see `catch`.
 *
 * The messages are deliberately generic. The raw Prisma message and
 * `meta.target` leak internal model, column, and constraint names, which a
 * caller — including an unauthenticated one, via `@PublicAccess` routes — could
 * use to map the schema (CWE-209). Full detail is logged instead.
 */
const CLIENT_FAULTS: Record<string, { status: HttpStatus; message: string }> = {
  // Asked to create something that is already there.
  P2002: {
    status: HttpStatus.CONFLICT,
    message: 'A record with the provided value already exists',
  },
  // Named a record that does not exist.
  P2025: {
    status: HttpStatus.NOT_FOUND,
    message: 'Record not found',
  },
  // Sent a value longer than the column can hold.
  P2000: {
    status: HttpStatus.BAD_REQUEST,
    message: 'The request could not be completed',
  },
  // Referenced a related record that does not exist.
  P2003: {
    status: HttpStatus.BAD_REQUEST,
    message: 'The request could not be completed',
  },
}

/**
 * Our fault, but TRANSIENT: the request was well-formed, the database could not
 * serve it at that moment, and the identical request may succeed on a retry.
 *
 * 503 rather than 500 so the distinction survives into the logs and the
 * dashboards — "the database is overloaded" and "we have a bug" want different
 * responses from whoever gets paged, and both are 5xx, so either one alerts.
 *
 * P2034 is worth singling out: Prisma's own guidance for a write conflict is to
 * retry, and contrastRouting.service.ts already does exactly that. So the
 * codebase was treating this as transient in one place while this filter called
 * it a bad request in another.
 */
const TRANSIENT_FAULTS = new Set([
  'P1008', // Operations timed out.
  'P1017', // Server has closed the connection.
  'P2024', // Timed out fetching a connection from the pool — pool exhaustion.
  'P2028', // Transaction expired mid-flight, or another transaction API error.
  'P2034', // Write conflict or deadlock.
])

@Catch(...prismaErrorClasses)
export class PrismaExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(PrismaExceptionFilter.name)
  }

  catch(
    exception: Prisma.PrismaClientKnownRequestError | Error,
    host: ArgumentsHost,
  ) {
    const ctx = host.switchToHttp()
    const response: {
      status: (code: number) => {
        send: (body: Record<string, (() => string) | string | number>) => void
      }
    } = ctx.getResponse()
    const request: { url: string; method: string } = ctx.getRequest()

    let statusCode: HttpStatus | null = null
    let message: string | null = null

    if (
      isPrismaError<Prisma.PrismaClientKnownRequestError>(
        exception,
        'PrismaClientKnownRequestError',
      )
    ) {
      this.logger.error(
        {
          err: exception,
          meta: exception.meta,
        },
        'Encountered known prisma exception',
      )
      const clientFault = CLIENT_FAULTS[exception.code]
      if (clientFault) {
        statusCode = clientFault.status
        message = clientFault.message
      } else if (TRANSIENT_FAULTS.has(exception.code)) {
        statusCode = HttpStatus.SERVICE_UNAVAILABLE
        message = 'The database was briefly unavailable. Please try again.'
      } else {
        // UNRECOGNISED CODES ARE OURS. This default is the whole point of the
        // change: it used to be 400, so every database fault nobody had
        // enumerated yet became an invisible "bad request". Defaulting to 500
        // means the next unenumerated infrastructure code is loud instead of
        // silent, and the fix is to add it above rather than to discover it
        // months later. A caller-shaped code landing here pages someone
        // unnecessarily, which is the failure we can actually see and correct.
        statusCode = HttpStatus.INTERNAL_SERVER_ERROR
        message = 'A database error occurred. Please try again later.'
      }
    } else if (isPrismaError(exception, 'PrismaClientRustPanicError')) {
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR
      message = 'A Prisma internal error occured. Please try again later.'
    } else if (isPrismaError(exception, 'PrismaClientValidationError')) {
      // Also a 400 until now, and also wrong. Prisma raises this when it
      // rejects the query we BUILT — an unknown field, a type that does not
      // match the column, a name a migration changed without the query being
      // updated. None of that is the caller's doing, and the route is broken
      // for everyone until someone ships a fix, which is the worst case to have
      // hidden behind a status code the alerting drops.
      //
      // It has not fired once in the 30 days to 2026-09-16, so this costs no
      // alert volume today; it stops the first occurrence being silent.
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR
      message = 'A database error occurred. Please try again later.'
    } else if (isPrismaError(exception, 'PrismaClientUnknownRequestError')) {
      // Was a 400, on the same mistaken reasoning as the default above: an
      // error Prisma itself cannot identify is not evidence that the caller
      // sent something wrong. "Unknown" is the definition of a case we have not
      // established a cause for, so it belongs on our side of the line.
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR
      message = 'An unknown error occured while processing the request.'
    } else if (isPrismaError(exception, 'PrismaClientInitializationError')) {
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR
      message = 'A database error occurred. Please try again later.'
    }

    if (!statusCode || !message) {
      throw exception
    }

    this.logger.error(
      {
        err: exception,
        url: (request as { url: string }).url,
        method: (request as { method: string }).method,
        statusCode,
      },
      `Exception caught: ${message}`,
    )

    const typedResponse = response as {
      status: (code: number) => {
        send: (body: Record<string, (() => string) | string | number>) => void
      }
    }
    typedResponse.status(statusCode).send({
      statusCode,
      timestamp: new Date().toISOString(),
      path: (request as { url: string }).url,
      error: message,
    })
  }
}
