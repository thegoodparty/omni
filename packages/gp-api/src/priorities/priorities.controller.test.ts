import { useTestService } from '@/test-service'
import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'vitest'
import { v7 as uuidv7 } from 'uuid'
import { Priority } from '@goodparty_org/contracts'

const service = useTestService()

const PRIORITIES_PATH = '/v1/priorities'

let eoOrgSlug: string

const eoHeaders = () => ({ headers: { 'x-organization-slug': eoOrgSlug } })

beforeEach(async () => {
  const id = uuidv7()
  eoOrgSlug = `eo-${id}`
  await service.prisma.organization.create({
    data: { slug: eoOrgSlug, ownerId: service.user.id },
  })
  await service.prisma.electedOffice.create({
    data: { id, userId: service.user.id, organizationSlug: eoOrgSlug },
  })
})

describe('priorities controller', () => {
  it('creates, lists, updates, and archives a priority', async () => {
    const created = await service.client.post<Priority>(
      PRIORITIES_PATH,
      { title: 'Housing', description: 'Build more homes' },
      eoHeaders(),
    )
    expect(created.status).toBe(HttpStatus.CREATED)
    expect(created.data).toMatchObject({
      title: 'Housing',
      description: 'Build more homes',
      source: 'user_stated',
    })

    const listed = await service.client.get<Priority[]>(
      PRIORITIES_PATH,
      eoHeaders(),
    )
    expect(listed.status).toBe(HttpStatus.OK)
    expect(listed.data).toHaveLength(1)

    const updated = await service.client.put<Priority>(
      `/v1/priorities/${created.data.id}`,
      { title: 'Affordable housing' },
      eoHeaders(),
    )
    expect(updated.status).toBe(HttpStatus.OK)
    expect(updated.data.title).toBe('Affordable housing')

    const removed = await service.client.delete(
      `/v1/priorities/${created.data.id}`,
      eoHeaders(),
    )
    expect(removed.status).toBe(HttpStatus.NO_CONTENT)

    const afterDelete = await service.client.get<Priority[]>(
      PRIORITIES_PATH,
      eoHeaders(),
    )
    expect(afterDelete.data).toHaveLength(0)
  })

  it('returns 404 when the elected office header is missing', async () => {
    const result = await service.client.get(PRIORITIES_PATH)
    expect(result.status).toBe(HttpStatus.NOT_FOUND)
  })
})
