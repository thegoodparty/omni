import { describe, expect, it } from 'vitest'
import { OrganizationRole } from '../generated/prisma'
import { getActorContext, runWithActorContext } from './impersonation-context'

const ownerContext = {
  isImpersonating: false,
  actorUserId: 7,
  actorRole: OrganizationRole.owner,
}

describe('impersonation-context', () => {
  describe('getActorContext', () => {
    it('returns undefined when called outside runWithActorContext', () => {
      expect(getActorContext()).toBeUndefined()
    })

    it('returns the stored context when run inside runWithActorContext', () => {
      runWithActorContext(ownerContext, () => {
        expect(getActorContext()).toEqual(ownerContext)
      })
    })

    it('carries a true isImpersonating flag through the store', () => {
      runWithActorContext({ ...ownerContext, isImpersonating: true }, () => {
        expect(getActorContext()?.isImpersonating).toBe(true)
      })
    })

    it('carries null actorUserId/actorRole for non-org-scoped requests', () => {
      runWithActorContext(
        { isImpersonating: false, actorUserId: 7, actorRole: null },
        () => {
          expect(getActorContext()).toEqual({
            isImpersonating: false,
            actorUserId: 7,
            actorRole: null,
          })
        },
      )
    })
  })

  describe('runWithActorContext', () => {
    it('returns the value from the callback', () => {
      const result = runWithActorContext(ownerContext, () => 'hello')
      expect(result).toBe('hello')
    })

    it('does not leak context outside the callback', () => {
      runWithActorContext(ownerContext, () => {
        expect(getActorContext()).toEqual(ownerContext)
      })
      expect(getActorContext()).toBeUndefined()
    })

    it('supports nested calls with different values', () => {
      runWithActorContext(ownerContext, () => {
        expect(getActorContext()).toEqual(ownerContext)
        runWithActorContext(
          { isImpersonating: true, actorUserId: 9, actorRole: null },
          () => {
            expect(getActorContext()?.actorUserId).toBe(9)
          },
        )
        expect(getActorContext()).toEqual(ownerContext)
      })
    })
  })
})
