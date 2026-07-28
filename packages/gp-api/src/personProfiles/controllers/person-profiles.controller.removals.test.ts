import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminOrM2MGuard } from '@/authentication/guards/AdminOrM2M.guard'
import { PersonProfilesController } from './person-profiles.controller'
import { PersonProfilesService } from '../services/person-profiles.service'
import { MarketingRevalidationService } from '../services/marketing-revalidation.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import type {
  ClearPersonProfileRemovalDto,
  SetPersonProfileRemovalDto,
} from '../schemas/PersonProfileRemoval.schema'

/**
 * The privacy-removal endpoints are the only writes on this controller that are
 * NOT owner-scoped (they target an unclaimed personId), so they are gated to
 * admin/M2M callers instead of req.user. That guard is the entire authorization
 * story for the K/L "removal requested" flow — assert it can't be dropped in a
 * refactor, plus the happy-path delegation and the cache-bust side effect.
 */
const guardsFor = (method: keyof PersonProfilesController) =>
  Reflect.getMetadata(
    '__guards__',
    PersonProfilesController.prototype[method],
  ) ?? []

describe('PersonProfilesController removals', () => {
  const PERSON_ID = '22222222-2222-2222-2222-222222222222'

  let controller: PersonProfilesController
  let profiles: {
    setRemoval: ReturnType<typeof vi.fn>
    clearRemoval: ReturnType<typeof vi.fn>
  }
  let revalidation: { revalidatePerson: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    profiles = {
      setRemoval: vi.fn().mockResolvedValue({ personId: PERSON_ID }),
      clearRemoval: vi.fn().mockResolvedValue(undefined),
    }
    revalidation = { revalidatePerson: vi.fn() }
    controller = new PersonProfilesController(
      profiles as unknown as PersonProfilesService,
      revalidation as unknown as MarketingRevalidationService,
      {} as unknown as S3Service,
    )
  })

  it('gates both removal endpoints behind AdminOrM2MGuard', () => {
    // A dropped decorator would silently expose an unauthenticated write that
    // can flip any person's public page to "removed", so pin the guard here.
    expect(guardsFor('setRemoval')).toContain(AdminOrM2MGuard)
    expect(guardsFor('clearRemoval')).toContain(AdminOrM2MGuard)
  })

  it('setRemoval delegates to the service and busts the marketing cache', async () => {
    const body = {
      personId: PERSON_ID,
      note: 'court order',
    } as SetPersonProfileRemovalDto

    const result = await controller.setRemoval(body)

    expect(profiles.setRemoval).toHaveBeenCalledWith(PERSON_ID, 'court order')
    expect(revalidation.revalidatePerson).toHaveBeenCalledWith(PERSON_ID)
    expect(result).toEqual({ personId: PERSON_ID, removed: true })
  })

  it('clearRemoval delegates to the service and busts the marketing cache', async () => {
    const body = { personId: PERSON_ID } as ClearPersonProfileRemovalDto

    const result = await controller.clearRemoval(body)

    expect(profiles.clearRemoval).toHaveBeenCalledWith(PERSON_ID)
    expect(revalidation.revalidatePerson).toHaveBeenCalledWith(PERSON_ID)
    expect(result).toEqual({ personId: PERSON_ID, removed: false })
  })
})
