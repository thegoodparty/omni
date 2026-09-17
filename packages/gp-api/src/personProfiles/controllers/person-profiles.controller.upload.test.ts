import { BadRequestException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PersonProfilesController } from './person-profiles.controller'
import { PersonProfilesService } from '../services/person-profiles.service'
import { MarketingRevalidationService } from '../services/marketing-revalidation.service'
import { PersonIdBackfillService } from '../services/person-id-backfill.service'
import { PersonLookupService } from '../services/person-lookup.service'
import { UsersService } from '@/users/services/users.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import type { FileUpload } from 'src/files/files.types'
import type { User } from '../../generated/prisma'

/**
 * Controller-level coverage for the avatar/cover upload path. Follows the repo's
 * upload-test convention (see users.controller.test.ts): the controller is
 * driven directly with a mocked S3Service so no bytes ever leave the process and
 * the multipart transport isn't exercised here — that's the interceptor's job.
 * What we assert is the controller's own logic: owner + profile gating, the
 * avatar-vs-cover field routing, and that the returned S3 URL is persisted onto
 * the overlay (never that a real object was written to a bucket).
 */
const UPLOADED_URL = 'https://assets.goodparty.org/person-profiles/x.png'

describe('PersonProfilesController.uploadImage', () => {
  const OWNER = { id: 42, personId: 'person-1' } as unknown as User
  const PROFILE = {
    id: 'profile-1',
    personId: 'person-1',
    publishedAt: null,
    deletedAt: null,
  }

  let controller: PersonProfilesController
  let profiles: {
    findByUserId: ReturnType<typeof vi.fn>
    updateForUser: ReturnType<typeof vi.fn>
  }
  let revalidation: { revalidatePerson: ReturnType<typeof vi.fn> }
  let s3: {
    buildKey: ReturnType<typeof vi.fn>
    uploadFile: ReturnType<typeof vi.fn>
  }

  const file = (name = 'headshot.png'): FileUpload =>
    ({
      data: Buffer.from('fake-image-bytes'),
      filename: name,
      mimetype: 'image/png',
    }) as unknown as FileUpload

  beforeEach(() => {
    profiles = {
      findByUserId: vi.fn().mockResolvedValue(PROFILE),
      updateForUser: vi
        .fn()
        .mockImplementation((_userId: number, patch: Record<string, unknown>) =>
          Promise.resolve({ ...PROFILE, ...patch }),
        ),
    }
    revalidation = { revalidatePerson: vi.fn() }
    s3 = {
      buildKey: vi.fn((folder: string, fname: string) => `${folder}/${fname}`),
      uploadFile: vi.fn().mockResolvedValue(UPLOADED_URL),
    }
    controller = new PersonProfilesController(
      profiles as unknown as PersonProfilesService,
      revalidation as unknown as MarketingRevalidationService,
      s3 as unknown as S3Service,
      {} as unknown as PersonIdBackfillService,
      {} as unknown as UsersService,
      {} as unknown as PersonLookupService,
    )
  })

  it('uploads to S3 and stores the URL as avatarUrl by default', async () => {
    const result = await controller.uploadImage(OWNER, undefined, file())

    expect(s3.uploadFile).toHaveBeenCalledTimes(1)
    // Persisted onto the avatar field, and the S3 URL is what gets stored.
    expect(profiles.updateForUser).toHaveBeenCalledWith(OWNER.id, {
      avatarUrl: UPLOADED_URL,
    })
    expect(result.avatarUrl).toBe(UPLOADED_URL)
    expect(result.coverImageUrl).toBeUndefined()
  })

  it('routes target=cover to coverImageUrl', async () => {
    const result = await controller.uploadImage(
      OWNER,
      'cover',
      file('banner.png'),
    )

    expect(profiles.updateForUser).toHaveBeenCalledWith(OWNER.id, {
      coverImageUrl: UPLOADED_URL,
    })
    expect(result.coverImageUrl).toBe(UPLOADED_URL)
  })

  it('scopes the S3 key to the owner and target so users can never collide', async () => {
    await controller.uploadImage(OWNER, 'avatar', file())
    expect(s3.buildKey).toHaveBeenCalledWith(
      `person-profiles/${OWNER.id}/avatar`,
      'headshot.png',
    )
  })

  it('does not revalidate marketing while the profile is an unpublished draft', async () => {
    await controller.uploadImage(OWNER, 'avatar', file())
    expect(revalidation.revalidatePerson).not.toHaveBeenCalled()
  })

  it('busts the marketing cache when the profile is already live', async () => {
    profiles.findByUserId.mockResolvedValue({
      ...PROFILE,
      publishedAt: new Date(),
    })
    await controller.uploadImage(OWNER, 'avatar', file())
    expect(revalidation.revalidatePerson).toHaveBeenCalledWith('person-1')
  })

  it('400s when no file is attached', async () => {
    await expect(
      controller.uploadImage(OWNER, 'avatar', undefined),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(s3.uploadFile).not.toHaveBeenCalled()
  })

  it('404s when the caller has no profile to attach the image to', async () => {
    profiles.findByUserId.mockResolvedValue(null)
    await expect(
      controller.uploadImage(OWNER, 'avatar', file()),
    ).rejects.toBeInstanceOf(NotFoundException)
    expect(s3.uploadFile).not.toHaveBeenCalled()
  })
})
