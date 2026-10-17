import { IncomingRequest } from '@/authentication/authentication.types'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { AdminOrM2MGuard } from '@/authentication/guards/AdminOrM2M.guard'
import { APP_ROOT } from '@/shared/util/appEnvironment.util'
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common'
import { Prisma, User, UserRole } from '../../generated/prisma'
import { subDays, subMonths } from 'date-fns'
import { PinoLogger } from 'nestjs-pino'
import { ZodValidationPipe } from 'nestjs-zod'
import { Roles } from 'src/authentication/decorators/Roles.decorator'
import { UsersService } from 'src/users/services/users.service'
import { AdminCreateUserSchema } from './schemas/AdminCreateUser.schema'
import { AdminSignInLinkSchema } from './schemas/AdminSignInLink.schema'
import {
  AdminUserListSchema,
  DateRangeFilter,
} from './schemas/AdminUserList.schema'

const SENSITIVE_USER_FIELDS = {
  password: true,
  passwordResetToken: true,
} as const

@Controller('admin/users')
@UsePipes(ZodValidationPipe)
export class AdminUsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdminUsersController.name)
  }

  @Get()
  @Roles(UserRole.admin)
  async list(@Query() { dateRange }: AdminUserListSchema) {
    const omit = SENSITIVE_USER_FIELDS
    if (!dateRange || dateRange === DateRangeFilter.allTime) {
      return this.usersService.findMany({ omit })
    }
    let date = new Date()
    if (dateRange === DateRangeFilter.last12Months) {
      date = subMonths(date, 12)
    } else if (dateRange === DateRangeFilter.last30Days) {
      date = subDays(date, 30)
    } else if (dateRange === DateRangeFilter.lastWeek) {
      date = subDays(date, 7)
    } else {
      throw new BadRequestException('Invalid date range')
    }

    return this.usersService.findMany({
      where: { createdAt: { gt: date } },
      omit,
    })
  }

  @Get('search')
  @UseGuards(AdminOrM2MGuard)
  async searchByEmail(@Query('email') email: string) {
    return this.usersService.findMany({
      where: { email: { contains: email, mode: Prisma.QueryMode.insensitive } },
      take: 10,
      select: { id: true, email: true, name: true },
    })
  }

  @Get(':id')
  @Roles(UserRole.admin)
  async get(@Param('id', ParseIntPipe) id: number) {
    return this.usersService.findUniqueOrThrow({
      where: { id },
      omit: SENSITIVE_USER_FIELDS,
    })
  }

  @Post()
  @Roles(UserRole.admin)
  async create(@Body() body: AdminCreateUserSchema) {
    const { id } = await this.usersService.createUser(body)
    return this.usersService.findUniqueOrThrow({
      where: { id },
      omit: SENSITIVE_USER_FIELDS,
    })
  }

  @Post('impersonate/:id')
  @UseGuards(AdminOrM2MGuard)
  async impersonate(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: IncomingRequest,
    @Body() body: { actorEmail?: string },
  ) {
    const actorClerkId = await this.resolveActorClerkId(req, body.actorEmail)

    this.logger.info(
      { targetUserId: id, actorClerkId, authSource: req.user ? 'user' : 'm2m' },
      'Impersonation request received',
    )

    const user = await this.usersService.findUniqueOrThrow({ where: { id } })
    return this.usersService.impersonateUser(user.id, actorClerkId)
  }

  @Post('sign-in-link/:id')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminOrM2MGuard)
  async createSignInLink(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: IncomingRequest,
    @Body() body: AdminSignInLinkSchema,
  ) {
    const m2mActor = req.user
      ? null
      : await this.findStaffActor(body.actorEmail)

    const user = await this.usersService.findUniqueOrThrow({ where: { id } })
    const { token, clerkId, expiresAt } =
      await this.usersService.createSignInLink(user.id)

    const actorClerkId =
      m2mActor?.clerkId ??
      req.actorUser?.clerkId ??
      req.user?.clerkId ??
      req.actorSub ??
      null

    // Minting a link is not permission-gated in gp-admin, so this line is the
    // only record of who did it.
    this.logger.info(
      {
        targetUserId: user.id,
        targetClerkId: user.clerkId,
        actorEmail: body.actorEmail ?? null,
        actorClerkId,
        actorSource: body.actorEmail
          ? 'actorEmail'
          : actorClerkId
            ? 'session'
            : 'unknown',
        authSource: req.user ? 'user' : 'm2m',
        expiresAt,
      },
      'Created admin sign-in link',
    )

    // Return only the ticketed URL — the raw sign-in token is already embedded
    // in `url` as __clerk_ticket, so returning it separately would only spread
    // the credential through extra logs and proxies. `uid` carries the ticket's
    // Clerk user id because the token itself has no user claim — the redemption
    // page needs it to recognize an already-signed-in recipient instead of
    // signing them out against a spent single-use ticket.
    const url = `${APP_ROOT}/sign-in-link?__clerk_ticket=${encodeURIComponent(
      token,
    )}&uid=${encodeURIComponent(clerkId)}`
    return { url, expiresAt }
  }

  // Resolves which Clerk ID to embed as actor.sub in the impersonation token.
  //
  // gp-admin and gp-api/gp-webapp run on separate Clerk instances, so an admin's
  // Clerk ID from gp-admin is never valid here. We accept actorEmail instead,
  // which must belong to a gp-api admin. If that admin's row has no Clerk ID,
  // we resolve the email against gp-api's Clerk instance and fall back to the
  // email string itself. Clerk does not validate actor.sub at token creation
  // time, so this works in practice; SessionGuard's startsWith('user_') check
  // prevents the downstream 404 latency on every subsequent request.
  private async resolveActorClerkId(
    req: IncomingRequest,
    actorEmail?: string,
  ): Promise<string> {
    // Happy path: actor resolved from the JWT (admin has a gp-api Clerk account)
    if (req.actorUser?.clerkId) return req.actorUser.clerkId

    // Direct admin session (no actor claim in the JWT)
    if (req.user && !req.actorSub && req.user.clerkId) {
      return req.user.clerkId
    }

    // Swap path: actor.sub is already embedded in the current JWT — carry it forward
    // without re-resolving so the actor identity stays consistent for the session
    if (req.actorSub) return req.actorSub

    // M2M initial impersonation from gp-admin: the named actor must be a
    // gp-api admin; use their Clerk ID, else resolve it by email
    const actor = await this.findStaffActor(actorEmail)
    if (actor.clerkId) return actor.clerkId

    const identity = await this.usersService.resolveClerkIdByEmail(actor.email)
    if (identity.source === 'email-fallback') {
      this.logger.warn(
        { actorEmail: actor.email },
        'Actor has no gp-api Clerk account — using email as actor.sub fallback',
      )
      return identity.email
    }
    return identity.clerkId
  }

  // An M2M token proves the calling service, not the person acting through it,
  // so the actor it names has to be a real admin here.
  private async findStaffActor(actorEmail?: string): Promise<User> {
    if (!actorEmail) {
      throw new BadRequestException(
        'actorEmail is required when using M2M auth',
      )
    }
    const actor = await this.usersService.findUserByEmail(actorEmail)
    if (!actor?.roles.includes(UserRole.admin)) {
      throw new ForbiddenException('actorEmail must belong to an admin user')
    }
    return actor
  }

  @Delete(':id')
  @Roles(UserRole.admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param('id', ParseIntPipe) id: number,
    @ReqUser() reqUser: { id: number },
  ) {
    const user = await this.usersService.findUniqueOrThrow({ where: { id } })

    await this.usersService.deleteUser(user.id, reqUser.id)

    return true
  }
}
