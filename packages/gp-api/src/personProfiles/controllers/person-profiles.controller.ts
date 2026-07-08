import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Put,
  UnauthorizedException,
  UsePipes,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { User } from '../../generated/prisma'
import {
  SetProfileIssuesDto,
  UpsertPersonProfileDto,
} from '../schemas/personProfile.schema'
import { PersonProfilesService } from '../services/person-profiles.service'
import { MarketingRevalidationService } from '../services/marketing-revalidation.service'
import { recordProfileMutation } from '../observability/person-profiles.metrics'

// Authenticated, owner-scoped management of the caller's own public profile.
// Every route is keyed on req.user (never a path param), so there is no way to
// address another user's profile. A user can only own a profile once the data
// team has minted their canonical Person (user.personId); until then create
// returns 409.
@Controller('person-profiles')
@UsePipes(ZodValidationPipe)
export class PersonProfilesController {
  constructor(
    private readonly personProfilesService: PersonProfilesService,
    private readonly revalidation: MarketingRevalidationService,
  ) {}

  private requireUser(user: User | undefined): User {
    // The global SessionGuard admits M2M tokens without populating request.user;
    // owning a profile is meaningless without a concrete user.
    if (!user) {
      throw new UnauthorizedException()
    }
    return user
  }

  @Get('mine')
  async getMine(@ReqUser() user: User) {
    const owner = this.requireUser(user)
    const profile = await this.personProfilesService.findByUserId(owner.id)
    // canCreate tells the editor whether the person is known to the civics
    // graph yet (i.e. whether POST would succeed).
    return { profile, canCreate: Boolean(owner.personId) }
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@ReqUser() user: User, @Body() body: UpsertPersonProfileDto) {
    const owner = this.requireUser(user)
    if (!owner.personId) {
      throw new ConflictException(
        'No canonical person record exists for this user yet; a public profile cannot be created until one is minted',
      )
    }
    const existing = await this.personProfilesService.findByUserId(owner.id)
    if (existing) {
      throw new ConflictException('A profile already exists for this user')
    }
    const created = await this.personProfilesService.createForUser(
      owner.id,
      owner.personId,
      body,
    )
    recordProfileMutation('create')
    return created
  }

  @Put('mine')
  async update(@ReqUser() user: User, @Body() body: UpsertPersonProfileDto) {
    const owner = this.requireUser(user)
    const existing = await this.requireOwnProfile(owner)
    const updated = await this.personProfilesService.updateForUser(
      owner.id,
      body,
    )
    recordProfileMutation('update')
    // Only busts the cache when the page is actually live.
    if (existing.publishedAt && !existing.deletedAt) {
      void this.revalidation.revalidatePerson(existing.personId)
    }
    return updated
  }

  @Post('mine/publish')
  @HttpCode(HttpStatus.OK)
  async publish(@ReqUser() user: User) {
    const owner = this.requireUser(user)
    const existing = await this.requireOwnProfile(owner)
    const updated = await this.personProfilesService.setPublished(
      owner.id,
      new Date(),
    )
    recordProfileMutation('publish')
    void this.revalidation.revalidatePerson(existing.personId)
    return updated
  }

  @Post('mine/unpublish')
  @HttpCode(HttpStatus.OK)
  async unpublish(@ReqUser() user: User) {
    const owner = this.requireUser(user)
    const existing = await this.requireOwnProfile(owner)
    const updated = await this.personProfilesService.setPublished(
      owner.id,
      null,
    )
    recordProfileMutation('unpublish')
    void this.revalidation.revalidatePerson(existing.personId)
    return updated
  }

  @Delete('mine')
  @HttpCode(HttpStatus.OK)
  async remove(@ReqUser() user: User) {
    const owner = this.requireUser(user)
    const existing = await this.requireOwnProfile(owner)
    const deleted = await this.personProfilesService.softDelete(owner.id)
    recordProfileMutation('delete')
    // Immediate propagation: the render gate reads deletedAt from gp-api, so the
    // page goes "gone" on the next request after this cache-bust — no
    // election-api write and no ETL dependency.
    void this.revalidation.revalidatePerson(existing.personId)
    return deleted
  }

  @Put('mine/issues')
  async setIssues(@ReqUser() user: User, @Body() body: SetProfileIssuesDto) {
    const owner = this.requireUser(user)
    const existing = await this.requireOwnProfile(owner)
    const updated = await this.personProfilesService.replaceIssues(
      existing.id,
      body.issues,
    )
    recordProfileMutation('set_issues')
    if (existing.publishedAt && !existing.deletedAt) {
      void this.revalidation.revalidatePerson(existing.personId)
    }
    return updated
  }

  private async requireOwnProfile(user: User) {
    const profile = await this.personProfilesService.findByUserId(user.id)
    if (!profile) {
      throw new NotFoundException('No profile exists for this user')
    }
    return profile
  }
}
