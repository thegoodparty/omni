import type {
  LinkPersonProfileOwnerInput,
  PersonProfileLink,
} from '@goodparty_org/contracts'
import type {
  ClearPersonProfileRemovalInput,
  ClearPersonProfileRemovalOutput,
  ListPersonProfileRemovalsOptions,
  PersonLookupResult,
  PersonProfileRemoval,
  SetPersonProfileRemovalInput,
  SetPersonProfileRemovalOutput,
} from '../types/personProfile'
import { BaseResource } from './BaseResource'

/**
 * Admin/ops surface for public /people profiles: privacy takedowns, and the
 * user-to-person link that unlocks a candidate's profile editor. Every route
 * here is admin/M2M-gated: unlike the public sitemap feed, these expose the
 * free-text ops note, the operator who acted, and which account owns a page.
 */
export class PersonProfilesResource extends BaseResource {
  protected readonly resourceBasePath = '/person-profiles'

  listRemovals = (
    options?: ListPersonProfileRemovalsOptions
  ): Promise<PersonProfileRemoval[]> =>
    this.getRequest<PersonProfileRemoval[]>(
      `${this.resourceBasePath}/removals`,
      options
    )

  /**
   * Idempotent: flagging an already-removed person refreshes the note and
   * actor, and re-flagging a reverted one reopens the same record.
   */
  setRemoval = (
    input: SetPersonProfileRemovalInput
  ): Promise<SetPersonProfileRemovalOutput> =>
    this.postRequest<SetPersonProfileRemovalOutput>(
      `${this.resourceBasePath}/removals`,
      input
    )

  /** Reverts a takedown. Clearing a person who has none is a no-op. */
  clearRemoval = (
    input: ClearPersonProfileRemovalInput
  ): Promise<ClearPersonProfileRemovalOutput> =>
    this.deleteRequest<ClearPersonProfileRemovalOutput>(
      `${this.resourceBasePath}/removals`,
      input
    )

  /**
   * Resolves a public `/people/...` URL or bare slug to the personId the
   * removal routes are keyed by. Rejects with a 404 `SdkError` when nothing
   * matches, so a typo surfaces before a page is taken down.
   */
  lookupPerson = (query: string): Promise<PersonLookupResult> =>
    this.getRequest<PersonLookupResult>(
      `${this.resourceBasePath}/removals/lookup`,
      { q: query }
    )

  /** Which civics person a user is linked to, if any, and whether they have a profile. */
  getLink = (userId: number): Promise<PersonProfileLink> =>
    this.getRequest<PersonProfileLink>(`${this.resourceBasePath}/links`, {
      userId,
    })

  /**
   * Links an unlinked user to a live person nobody else holds. Rejects with a
   * 409 when either side is already taken and a 400 naming the survivor when
   * the person was merged away; it never moves an existing link.
   */
  linkOwner = (
    input: LinkPersonProfileOwnerInput
  ): Promise<PersonProfileLink> =>
    this.postRequest<PersonProfileLink>(`${this.resourceBasePath}/links`, input)
}
