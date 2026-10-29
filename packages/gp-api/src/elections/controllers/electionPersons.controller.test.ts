import { describe, expect, it } from 'vitest'
import { RESPONSE_SCHEMA_KEY } from '@/shared/decorators/ResponseSchema.decorator'
import {
  ElectionPersonsController,
  personListResponseSchema,
  personSpineResponseSchema,
} from './electionPersons.controller'

const getResponseSchema = (methodName: keyof ElectionPersonsController) =>
  Reflect.getMetadata(
    RESPONSE_SCHEMA_KEY,
    ElectionPersonsController.prototype[methodName],
  )

const getPath = (methodName: keyof ElectionPersonsController) =>
  Reflect.getMetadata('path', ElectionPersonsController.prototype[methodName])

// A row as Prisma hands it back, plus the three columns no person response may
// ever carry. The service omits them; the response schema is the second lock.
const personRow = {
  id: '11111111-1111-1111-1111-111111111111',
  slug: 'jane-doe-11111111',
  firstName: 'Jane',
  lastName: 'Doe',
  state: 'TX',
  isPledged: true,
  email: 'jane@example.com',
  phone: '5125550100',
  gpApiUserId: '4242',
}

const spineRow = {
  ...personRow,
  OfficeHolders: [
    {
      id: '22222222-2222-2222-2222-222222222222',
      personId: personRow.id,
      positionName: 'Mayor',
      isCurrent: true,
      positionSlug: 'tx/hidalgo/mission/mayor',
      positionLevel: 'CITY',
      officeEmail: 'mayor@example.gov',
    },
  ],
  Candidacies: [
    {
      id: '33333333-3333-3333-3333-333333333333',
      slug: 'jane-doe-mayor',
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane@example.com',
      Race: {
        electionDate: new Date('2024-11-05'),
        slug: 'tx/hidalgo/mission/mayor',
        positionLevel: 'CITY',
      },
    },
  ],
}

describe('ElectionPersonsController', () => {
  describe('routing', () => {
    it('exposes the four marketing paths under the controller', () => {
      expect(getPath('getPersons')).toBe('/')
      expect(getPath('getPersonBySlug')).toBe('by-slug/:slug')
      expect(getPath('getPersonById')).toBe(':personId')
    })

    it('declares by-slug/:slug before :personId', () => {
      const methods = Object.getOwnPropertyNames(
        ElectionPersonsController.prototype,
      )
      expect(methods.indexOf('getPersonBySlug')).toBeLessThan(
        methods.indexOf('getPersonById'),
      )
    })
  })

  describe('getPersons', () => {
    it('is wired to the list response schema', () => {
      expect(getResponseSchema('getPersons')).toBe(personListResponseSchema)
    })

    it('strips undeclared columns from the response', () => {
      const parsed = personListResponseSchema.parse([personRow])[0]!

      expect(parsed).not.toHaveProperty('email')
      expect(parsed).not.toHaveProperty('phone')
      expect(parsed).not.toHaveProperty('gpApiUserId')
      expect(parsed.slug).toBe('jane-doe-11111111')
    })
  })

  describe('getPersonBySlug', () => {
    it('is wired to the spine response schema', () => {
      expect(getResponseSchema('getPersonBySlug')).toBe(
        personSpineResponseSchema,
      )
    })

    it('strips undeclared columns from the person and its relations', () => {
      const parsed = personSpineResponseSchema.parse(spineRow)

      expect(parsed).not.toHaveProperty('email')
      expect(parsed).not.toHaveProperty('gpApiUserId')
      expect(parsed.Candidacies[0]!).not.toHaveProperty('email')
      expect(parsed.OfficeHolders[0]?.positionSlug).toBe(
        'tx/hidalgo/mission/mayor',
      )
    })
  })

  describe('getPersonById', () => {
    it('is wired to the spine response schema', () => {
      expect(getResponseSchema('getPersonById')).toBe(personSpineResponseSchema)
    })

    it('strips undeclared columns from the response', () => {
      const parsed = personSpineResponseSchema.parse(spineRow)

      expect(parsed).not.toHaveProperty('phone')
      expect(parsed.OfficeHolders[0]!).not.toHaveProperty('Position')
    })
  })
})
