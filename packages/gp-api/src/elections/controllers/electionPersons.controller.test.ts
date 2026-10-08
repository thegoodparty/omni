import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { M2MOnly } from '@/authentication/guards/M2MOnly.guard'
import {
  GetPersonByIdParamsDTO,
  GetPersonBySlugParamsDTO,
  PersonFilterDto,
} from '@/electionDb/persons/persons.schema'
import { PersonsService } from '@/electionDb/persons/persons.service'
import { RESPONSE_SCHEMA_KEY } from '@/shared/decorators/ResponseSchema.decorator'
import {
  ElectionPersonsController,
  personListResponseSchema,
  personSpineResponseSchema,
} from './electionPersons.controller'

const getGuards = (methodName: keyof ElectionPersonsController) =>
  Reflect.getMetadata(
    '__guards__',
    ElectionPersonsController.prototype[methodName],
  ) ?? []

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
  let controller: ElectionPersonsController
  let getPersons: Mock
  let getPersonBySlug: Mock
  let getPersonById: Mock

  beforeEach(() => {
    getPersons = vi.fn()
    getPersonBySlug = vi.fn()
    getPersonById = vi.fn()

    const personsServiceMock: Partial<PersonsService> = {
      getPersons,
      getPersonBySlug,
      getPersonById,
    }

    controller = new ElectionPersonsController(
      personsServiceMock as PersonsService,
    )
  })

  describe('guards', () => {
    it('protects getPersons with M2MOnly', () => {
      expect(getGuards('getPersons')).toContain(M2MOnly)
    })

    it('protects getPersonBySlug with M2MOnly', () => {
      expect(getGuards('getPersonBySlug')).toContain(M2MOnly)
    })

    it('protects getPersonById with M2MOnly', () => {
      expect(getGuards('getPersonById')).toContain(M2MOnly)
    })
  })

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
    const filterDto: PersonFilterDto = {
      state: 'TX',
      ids: undefined,
      includeOfficeHolders: false,
      includeCandidacies: false,
    }

    it('delegates the filter straight to the service', async () => {
      getPersons.mockResolvedValue([personRow])

      const result = await controller.getPersons(filterDto)

      expect(getPersons).toHaveBeenCalledWith(filterDto)
      expect(result).toEqual([personRow])
    })

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
    const params: GetPersonBySlugParamsDTO = { slug: 'jane-doe-11111111' }

    it('delegates the slug to the service', async () => {
      getPersonBySlug.mockResolvedValue(spineRow)

      const result = await controller.getPersonBySlug(params)

      expect(getPersonBySlug).toHaveBeenCalledWith('jane-doe-11111111')
      expect(result).toEqual(spineRow)
    })

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
    const params: GetPersonByIdParamsDTO = { personId: personRow.id }

    it('delegates the id to the service', async () => {
      getPersonById.mockResolvedValue(spineRow)

      const result = await controller.getPersonById(params)

      expect(getPersonById).toHaveBeenCalledWith(personRow.id)
      expect(result).toEqual(spineRow)
    })

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
