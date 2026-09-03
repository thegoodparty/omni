import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import { OrganizationRole } from '../../generated/prisma'

export const ReqOrganizationRole = createParamDecorator(
  (_: undefined, ctx: ExecutionContext): OrganizationRole | undefined => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ organizationRole?: OrganizationRole }>()
    return request.organizationRole
  },
)
