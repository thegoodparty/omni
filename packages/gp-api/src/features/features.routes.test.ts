import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { OrganizationRole } from '@/generated/prisma'
import { useTestService } from '@/test-service'
import { FeaturesService } from './services/features.service'

const service = useTestService()

// Every page seeds its flags from this route, and the org the request names
// decides the org-scoped ones (ORGANIZATION_FLAGS). So the guard that
// resolves the org has to admit a volunteer, and pass a slug the user is no
// member of through as no org rather than 404 the whole page.
describe('GET /v1/experiment/variants', () => {
  const spyOnVariants = () => {
    const spy = vi
      .spyOn(service.app.get(FeaturesService), 'getAllVariants')
      .mockResolvedValue({})
    onTestFinished(() => spy.mockRestore())
    return spy
  }

  const createOrg = async (slug: string) => {
    const owner = await service.prisma.user.create({
      data: { email: `${slug}-owner@example.com` },
    })
    return service.prisma.organization.create({
      data: { slug, ownerId: owner.id },
    })
  }

  it('evaluates a volunteer in the org the request names', async () => {
    const org = await createOrg('flags-volunteer-org')
    await service.prisma.organizationMembership.create({
      data: {
        organizationSlug: org.slug,
        userId: service.user.id,
        role: OrganizationRole.volunteer,
      },
    })
    const getAllVariants = spyOnVariants()

    const res = await service.client.get('/v1/experiment/variants', {
      headers: { 'x-organization-slug': org.slug },
    })

    expect(res.status).toBe(200)
    expect(getAllVariants).toHaveBeenCalledWith(
      expect.objectContaining({ id: service.user.id }),
      expect.objectContaining({ slug: org.slug, ownerId: org.ownerId }),
    )
  })

  it('reads a slug the user is no member of as no org', async () => {
    const org = await createOrg('flags-foreign-org')
    const getAllVariants = spyOnVariants()

    const res = await service.client.get('/v1/experiment/variants', {
      headers: { 'x-organization-slug': org.slug },
    })

    expect(res.status).toBe(200)
    expect(getAllVariants).toHaveBeenCalledWith(
      expect.objectContaining({ id: service.user.id }),
      undefined,
    )
  })

  it('reads no org when the request names none', async () => {
    const variants = { 'campaign-story': { value: 'on', key: 'on' } }
    const getAllVariants = spyOnVariants().mockResolvedValue(variants)

    const res = await service.client.get('/v1/experiment/variants')

    expect(res.status).toBe(200)
    expect(res.data).toEqual({ variants })
    expect(getAllVariants).toHaveBeenCalledWith(
      expect.objectContaining({ id: service.user.id }),
      undefined,
    )
  })
})
