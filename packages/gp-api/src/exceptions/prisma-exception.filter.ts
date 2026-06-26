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

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      this.logger.error(
        {
          err: exception,
          meta: exception.meta,
        },
        'Encountered known prisma exception',
      )
      // Client-facing messages are intentionally generic: the raw Prisma
      // message / meta.target leaks internal model, column, and constraint
      // names that a caller (incl. unauthenticated, via @PublicAccess routes)
      // could use to map the schema (CWE-209). Full detail is logged above.
      switch (exception.code) {
        case 'P2002': // Unique constraint violation
          statusCode = HttpStatus.CONFLICT
          message = 'A record with the provided value already exists'
          break
        case 'P2025': // Record not found
          statusCode = HttpStatus.NOT_FOUND
          message = 'Record not found'
          break
        default:
          statusCode = HttpStatus.BAD_REQUEST
          message = 'The request could not be completed'
          break
      }
    } else if (exception instanceof Prisma.PrismaClientRustPanicError) {
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR
      message = 'A Prisma internal error occured. Please try again later.'
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      statusCode = HttpStatus.BAD_REQUEST
      message = 'Invalid request data'
    } else if (exception instanceof Prisma.PrismaClientUnknownRequestError) {
      statusCode = HttpStatus.BAD_REQUEST
      message = 'An unknown error occured while processing the request.'
    } else if (exception instanceof Prisma.PrismaClientInitializationError) {
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
