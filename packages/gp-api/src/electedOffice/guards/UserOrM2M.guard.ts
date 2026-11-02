import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { M2MCaller } from '@/authentication/authentication.types'
import { User } from '../../generated/prisma'

@Injectable()
export class UserOrM2MGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const { user, m2mToken } = context.switchToHttp().getRequest<{
      user?: User
      m2mToken?: M2MCaller
    }>()
    return Boolean(m2mToken || user)
  }
}
