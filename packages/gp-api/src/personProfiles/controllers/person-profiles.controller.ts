import {
  BadRequestException,
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
  Query,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common'
import { ZodValidationPipe } from 'nestjs-zod'
import { CacheControls, MimeTypes } from 'http-constants-ts'
import { ReqUser } from '@/authentication/decorators/ReqUser.decorator'
import { AdminOrM2MGuard } from '@/authentication/guards/AdminOrM2M.guard'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { ASSET_DOMAIN } from '@/shared/util/appEnvironment.util'
import { FileUpload } from 'src/files/files.types'
import { ReqFile } from 'src/files/decorators/ReqFiles.decorator'
import { FilesInterceptor } from 'src/files/interceptors/files.interceptor'
import { User } from '../../generated/prisma'
import {
  SetProfileIssuesDto,
  UpsertPersonProfileDto,
} from '../schemas/personProfile.schema'
import {
  ClearPersonProfileRemovalDto,
  SetPersonProfileRemovalDto,
} from '../schemas/PersonProfileRemoval.schema'
import { PersonProfilesService } from '../services/person-profiles.service'
import { MarketingRevalidationService } from '../services/marketing-revalidation.service'
import { recordProfileMutation } from '../observability/person-profiles.metrics'

// Upper bound for an avatar/cover upload. The interceptor buffers the file in
// memory, so this cap protects the pod from an oversized (or malicious) body.
const MAX_PROFILE_IMAGE_BYTES = 8_000_000

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
    private readonly s3: S3Service,
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
      owner.id,
    )
    recordProfileMutation('set_issues')
    if (existing.publishedAt && !existing.deletedAt) {
      void this.revalidation.revalidatePerson(existing.personId)
    }
    return updated
  }

  // Profile photo / cover upload (§4 "Profile Photo"). Multipart image → S3 →
  // stores the CDN URL on the overlay (avatar or cover). Owner-scoped via
  // req.user; a profile must exist first (create returns the row to edit).
  @Post('mine/upload-image')
  @UseInterceptors(
    FilesInterceptor('file', {
      mode: 'buffer',
      // Single avatar/cover per request. Bound the in-memory buffer so an
      // authenticated caller can't exhaust pod memory with an oversized upload.
      numFiles: 1,
      sizeLimit: MAX_PROFILE_IMAGE_BYTES,
      mimeTypes: [
        MimeTypes.IMAGE_JPEG,
        MimeTypes.IMAGE_GIF,
        MimeTypes.IMAGE_PNG,
      ],
    }),
  )
  async uploadImage(
    @ReqUser() user: User,
    @Query('target') target?: string,
    @ReqFile() file?: FileUpload,
  ) {
    const owner = this.requireUser(user)
    const existing = await this.requireOwnProfile(owner)
    if (!file) {
      throw new BadRequestException('No file found')
    }
    const which = target === 'cover' ? 'cover' : 'avatar'

    const key = this.s3.buildKey(
      `person-profiles/${owner.id}/${which}`,
      file.filename,
    )
    const url = await this.s3.uploadFile(ASSET_DOMAIN, file.data, key, {
      contentType: file.mimetype,
      cacheControl: `${CacheControls.MAX_AGE}=${31_536_000}`,
      baseUrl: `https://${ASSET_DOMAIN}`,
    })

    const updated = await this.personProfilesService.updateForUser(owner.id, {
      ...(which === 'cover' ? { coverImageUrl: url } : { avatarUrl: url }),
    })
    recordProfileMutation('update')
    if (existing.publishedAt && !existing.deletedAt) {
      void this.revalidation.revalidatePerson(existing.personId)
    }
    return updated
  }

  // --- Admin/ops privacy removal (minimal setter; no admin UI yet) ----------
  // Not owner-scoped: removal typically targets an *unclaimed* person (no User,
  // no PersonProfile), so it is keyed by personId and gated to admin/M2M
  // callers rather than req.user. Setting/clearing busts the marketing cache so
  // the page flips to/from the K/L "removal requested" states immediately.
  @Post('removals')
  @UseGuards(AdminOrM2MGuard)
  @HttpCode(HttpStatus.OK)
  async setRemoval(@Body() body: SetPersonProfileRemovalDto) {
    const removal = await this.personProfilesService.setRemoval(
      body.personId,
      body.note,
    )
    void this.revalidation.revalidatePerson(body.personId)
    return { personId: removal.personId, removed: true as const }
  }

  @Delete('removals')
  @UseGuards(AdminOrM2MGuard)
  @HttpCode(HttpStatus.OK)
  async clearRemoval(@Body() body: ClearPersonProfileRemovalDto) {
    await this.personProfilesService.clearRemoval(body.personId)
    void this.revalidation.revalidatePerson(body.personId)
    return { personId: body.personId, removed: false as const }
  }

  private async requireOwnProfile(user: User) {
    const profile = await this.personProfilesService.findByUserId(user.id)
    if (!profile) {
      throw new NotFoundException('No profile exists for this user')
    }
    return profile
  }
}
