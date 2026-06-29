import { describe, expect, it } from 'vitest'
import { User } from '../../generated/prisma'
import { IncomingRequest } from '@/authentication/authentication.types'
import { effectiveUser } from './effectiveUser.util'

const subject = { id: 1, name: 'Subject' } as unknown as User & {
  impersonating?: boolean
}
const actor = { id: 2, name: 'Actor' } as unknown as User

describe('effectiveUser', () => {
  it('returns the impersonated actor when one is resolved', () => {
    const req = { user: subject, actorUser: actor } as IncomingRequest

    expect(effectiveUser(req)).toBe(actor)
  })

  it('falls back to the session user when there is no actor', () => {
    const req = { user: subject } as IncomingRequest

    expect(effectiveUser(req)).toBe(subject)
  })

  it('returns undefined when neither actor nor user is present', () => {
    const req = {} as IncomingRequest

    expect(effectiveUser(req)).toBeUndefined()
  })
})
