import { AsyncLocalStorage } from 'async_hooks'
import { OrganizationRole } from '../generated/prisma'

export interface ActorContext {
  isImpersonating: boolean
  actorUserId: number | null
  actorRole: OrganizationRole | null
}

export const impersonationStorage = new AsyncLocalStorage<ActorContext>()

export function getActorContext(): ActorContext | undefined {
  return impersonationStorage.getStore()
}

export function runWithActorContext<T>(context: ActorContext, fn: () => T): T {
  return impersonationStorage.run(context, fn)
}
