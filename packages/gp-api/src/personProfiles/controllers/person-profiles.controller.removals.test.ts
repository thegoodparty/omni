import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminOrM2MGuard } from '@/authentication/guards/AdminOrM2M.guard'
import { PersonProfilesController } from './person-profiles.controller'
import { PersonProfilesService } from '../services/person-profiles.service'
import { MarketingRevalidationService } from '../services/marketing-revalidation.service'
import { PersonIdBackfillService } from '../services/person-id-backfill.service'
import { PersonLookupService } from '../services/person-lookup.service'
import { UsersService } from '@/users/services/users.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import type {
  ClearPersonProfileRemovalDto,
  ListPersonProfileRemovalsDto,
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
  const OPERATOR = 'ops@goodparty.org'

  let controller: PersonProfilesController
  let profiles: {
    setRemoval: ReturnType<typeof vi.fn>
    clearRemoval: ReturnType<typeof vi.fn>
    listRemovals: ReturnType<typeof vi.fn>
  }
  let revalidation: { revalidatePerson: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    profiles = {
      setRemoval: vi.fn().mockResolvedValue({ personId: PERSON_ID }),
      clearRemoval: vi.fn().mockResolvedValue(undefined),
      listRemovals: vi.fn().mockResolvedValue([]),
    }
    revalidation = { revalidatePerson: vi.fn() }
    controller = new PersonProfilesController(
      profiles as unknown as PersonProfilesService,
      revalidation as unknown as MarketingRevalidationService,
      {} as unknown as S3Service,
      {} as unknown as PersonIdBackfillService,
      {} as unknown as UsersService,
      {} as unknown as PersonLookupService,
    )
  })

  it('gates every removal endpoint behind AdminOrM2MGuard', () => {
    // A dropped decorator would silently expose an unauthenticated write that
    // can flip any person's public page to "removed", so pin the guard here.
    // The read matters just as much: it is the only removal shape that carries
    // the ops note and the actor.
    expect(guardsFor('setRemoval')).toContain(AdminOrM2MGuard)
    expect(guardsFor('clearRemoval')).toContain(AdminOrM2MGuard)
    expect(guardsFor('listRemovals')).toContain(AdminOrM2MGuard)
  })

  it('setRemoval delegates to the service and busts the marketing cache', async () => {
    const body = {
      personId: PERSON_ID,
      appliedBy: OPERATOR,
      note: 'court order',
    } as SetPersonProfileRemovalDto

    const result = await controller.setRemoval(body)

    expect(profiles.setRemoval).toHaveBeenCalledWith(
      PERSON_ID,
      OPERATOR,
      'court order',
    )
    expect(revalidation.revalidatePerson).toHaveBeenCalledWith(PERSON_ID)
    expect(result).toEqual({ personId: PERSON_ID, removed: true })
  })

  it('clearRemoval delegates to the service and busts the marketing cache', async () => {
    const body = {
      personId: PERSON_ID,
      clearedBy: OPERATOR,
    } as ClearPersonProfileRemovalDto

    const result = await controller.clearRemoval(body)

    expect(profiles.clearRemoval).toHaveBeenCalledWith(PERSON_ID, OPERATOR)
    expect(revalidation.revalidatePerson).toHaveBeenCalledWith(PERSON_ID)
    expect(result).toEqual({ personId: PERSON_ID, removed: false })
  })

  // The actor is the entire point of the attribution work: M2M callers are
  // anonymous to gp-api, so a handler that drops the field on the floor leaves
  // no record of who took a page down.
  it('forwards the operator on both writes', async () => {
    await controller.setRemoval({
      personId: PERSON_ID,
      appliedBy: 'system:privacy-backfill',
    } as SetPersonProfileRemovalDto)
    await controller.clearRemoval({
      personId: PERSON_ID,
      clearedBy: 'system:privacy-backfill',
    } as ClearPersonProfileRemovalDto)

    expect(profiles.setRemoval).toHaveBeenCalledWith(
      PERSON_ID,
      'system:privacy-backfill',
      undefined,
    )
    expect(profiles.clearRemoval).toHaveBeenCalledWith(
      PERSON_ID,
      'system:privacy-backfill',
    )
  })

  it('lists active takedowns by default and cleared ones on request', async () => {
    await controller.listRemovals({} as ListPersonProfileRemovalsDto)
    expect(profiles.listRemovals).toHaveBeenCalledWith({
      includeCleared: false,
    })

    await controller.listRemovals({
      includeCleared: true,
    } as ListPersonProfileRemovalsDto)
    expect(profiles.listRemovals).toHaveBeenCalledWith({
      includeCleared: true,
    })
  })
})
