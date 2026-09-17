import {
  CallHandler,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  NestInterceptor,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Observable, map } from 'rxjs'
import { ZodSchema } from 'zod'
import { RESPONSE_SCHEMA_KEY } from '../decorators/ResponseSchema.decorator'
import { PinoLogger } from 'nestjs-pino'

@Injectable()
export class ZodResponseInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ZodResponseInterceptor.name)
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const schema = this.reflector.get<ZodSchema<unknown> | undefined>(
      RESPONSE_SCHEMA_KEY,
      context.getHandler(),
    )

    if (!schema) {
      return next.handle()
    }

    return next.handle().pipe(
      map((data) => {
        const result = schema.safeParse(data)
        if (!result.success) {
          // `flatten()` only reports top-level keys, so every nested failure
          // collapses onto its parent: a bad `details.officeTermLength` logged
          // as `fieldErrors: { details: [...] }`, indistinguishable from any
          // other field under `details`. `issues` carries the full path, so
          // the log names the offending field for every @ResponseSchema route.
          this.logger.error(
            {
              issues: result.error.issues.map((issue) => ({
                path: issue.path.join('.') || '<root>',
                code: issue.code,
                message: issue.message,
              })),
            },
            'Response validation failed:',
          )
          throw new InternalServerErrorException('Response validation failed')
        }
        return result.data
      }),
    )
  }
}
