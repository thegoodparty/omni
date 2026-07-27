import { Injectable, NotFoundException } from '@nestjs/common'
import {
  buildColumnSelect,
  createPrismaBase,
  MODELS,
} from 'src/prisma/util/prisma.util'
import { PersonFilterDto } from './persons.schema'
import { Prisma } from '../generated/prisma'

// Candidacy carries PII (`email`); never expose it when nesting candidacies
// under a Person on this public endpoint.
const CANDIDACY_INCLUDE = { omit: { email: true } } as const

@Injectable()
export class PersonsService extends createPrismaBase(MODELS.Person) {
  async getPersons(filterDto: PersonFilterDto) {
    const {
      slug,
      personId,
      ids,
      state,
      columns,
      includeOfficeHolders,
      includeCandidacies,
    } = filterDto

    const where: Prisma.PersonWhereInput = {
      ...(slug && { slug }),
      ...(personId && { id: personId }),
      ...(ids && ids.length > 0 && { id: { in: ids } }),
      ...(state && { state }),
    }

    const relations = {
      ...(includeOfficeHolders ? { OfficeHolders: true } : {}),
      ...(includeCandidacies ? { Candidacies: CANDIDACY_INCLUDE } : {}),
    }

    // Column allowlist already excludes PII; append relation selects to it.
    if (columns) {
      const select = {
        ...(buildColumnSelect(columns) as Prisma.PersonSelect),
        ...relations,
      }
      return this.model.findMany({ where, select })
    }

    // Default path returns every scalar, so omit personal PII here too.
    return this.model.findMany({
      where,
      omit: { email: true, phone: true },
      include: relations,
    })
  }

  // Powers the public profile page: the full spine for one person, including
  // every office term and candidacy, with PII omitted.
  async getPersonById(personId: string) {
    const person = await this.model.findUnique({
      where: { id: personId },
      omit: { email: true, phone: true },
      include: {
        OfficeHolders: true,
        Candidacies: CANDIDACY_INCLUDE,
      },
    })
    if (!person) {
      throw new NotFoundException(`Person not found for id=${personId}`)
    }
    return person
  }

  // Resolves the canonical /people/<slug> URL to a person. `slug` is unique, so
  // this returns the same full spine shape as getPersonById (PII omitted).
  async getPersonBySlug(slug: string) {
    const person = await this.model.findUnique({
      where: { slug },
      omit: { email: true, phone: true },
      include: {
        OfficeHolders: true,
        Candidacies: CANDIDACY_INCLUDE,
      },
    })
    if (!person) {
      throw new NotFoundException(`Person not found for slug=${slug}`)
    }
    return person
  }
}
