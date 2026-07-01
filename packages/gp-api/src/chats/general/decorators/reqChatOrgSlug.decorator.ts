import { createParamDecorator, ExecutionContext } from '@nestjs/common'

// The organization slug ChatOrgGuard resolved (and authorized) for this request,
// whether it came from the user's elected office or their campaign.
export const ReqChatOrgSlug = createParamDecorator(
  (_: undefined, ctx: ExecutionContext): string => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ chatOrganizationSlug: string }>()
    return request.chatOrganizationSlug
  },
)
