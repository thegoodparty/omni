import {
  BadGatewayException,
  BadRequestException,
  InternalServerErrorException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common'
import { ServiceException } from '@smithy/smithy-client'
import { PinoLogger } from 'nestjs-pino'

/**
 * Base class for AWS services that provides common error handling and functionality
 * Extend this class to create specific AWS service implementations
 */
export abstract class AwsService {
  /**
   * Handles AWS SDK errors by mapping them to appropriate HTTP exceptions
   * - User input errors (400s) -> BadRequestException
   * - Auth errors (401/403s) -> UnauthorizedException/ForbiddenException
   * - Any other client fault -> InternalServerErrorException (we asked wrongly)
   * - AWS service faults -> BadGatewayException (AWS is failing)
   * @param error - The AWS error to handle
   * @param message - Optional message to add to the error log
   */
  private handleAwsError(error: unknown, message?: string): never {
    this.logger.debug({ error }, `AWS error: ${message}`)

    if (error instanceof ServiceException) {
      // Handle user input validation errors (400s)
      switch (error.name) {
        case 'InvalidInput':
        case 'InvalidParameter':
        case 'InvalidParameterValue':
        case 'ValidationError':
        case 'InvalidRequest':
        case 'MalformedQueryString':
        case 'MissingParameter':
        case 'InvalidArgument':
          throw new BadRequestException(error.message)

        // Handle authentication errors (401s)
        case 'AccessDeniedException':
        case 'NotAuthorized':
        case 'InvalidSignatureException':
        case 'SignatureDoesNotMatch':
        case 'ExpiredTokenException':
        case 'InvalidToken':
          throw new UnauthorizedException(error.message)

        // Handle authorization errors (403s)
        case 'OptInRequired':
        case 'InsufficientPermissions':
        case 'AccountProblem':
          throw new ForbiddenException(error.message)

        // Everything else splits on who the SDK says was at fault, rather than
        // falling through to 502 on the assumption that an unlisted name means
        // AWS broke. The cases above are an allowlist of a dozen names, so the
        // default was carrying every client fault nobody had thought to add —
        // and calling them all "Error communicating with AWS service".
        //
        // 502 is the expensive half of that mistake, because it does not just
        // mislabel: it tells the caller the failure is transient and worth
        // retrying. A dev briefing tab believed it 768 times in a week, once
        // every five minutes, against an S3 PermanentRedirect that could never
        // have succeeded — its row points at a bucket named `seed` that lives
        // in ap-south-1 and is not ours. The request was answered 122ms later
        // with `$fault: "client"` and HTTP 301, which is AWS saying plainly
        // that we asked wrongly.
        //
        // So a client fault we did not name is a 500: we built a bad request,
        // the caller cannot fix it by changing theirs, and a retry cannot help.
        // Only a server fault is a gateway error.
        default:
          throw error.$fault === 'client'
            ? new InternalServerErrorException(
                'A request to AWS could not be completed.',
              )
            : new BadGatewayException('Error communicating with AWS service')
      }
    }

    // If it's not an AWS error, rethrow it
    throw error
  }

  /**
   * Wraps an AWS service call with error handling
   * @param operation - The AWS operation to execute
   * @param message - Optional message to add to the error log
   */
  protected async executeAwsOperation<T>(
    operation: () => Promise<T>,
    message?: string,
  ): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      // If this is an AWS SDK v3 error, handle it
      if (error instanceof ServiceException) {
        this.handleAwsError(error, message)
      }

      // If it's not an AWS error, rethrow it
      throw error
    }
  }

  constructor(protected readonly logger: PinoLogger) {
    this.logger.setContext(this.constructor.name)
  }
}
