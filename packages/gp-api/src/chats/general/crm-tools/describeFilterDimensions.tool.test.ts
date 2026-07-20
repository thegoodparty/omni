import { describe, expect, it, vi } from 'vitest'
import type { Organization } from '../../../generated/prisma'
import { FILTER_DIMENSIONS } from '@/contacts/filterDimensions.catalog'
import { buildDescribeFilterDimensionsTool } from './describeFilterDimensions.tool'

const ORGANIZATION = { slug: 'eo-council' } as Organization

describe('buildDescribeFilterDimensionsTool', () => {
  it('returns the catalog for the server-bound organization', async () => {
    const serveDimensions = FILTER_DIMENSIONS.filter((d) => d.modes !== 'win')
    const getFilterDimensions = vi.fn(() => serveDimensions)
    const tool = buildDescribeFilterDimensionsTool({
      contacts: { getFilterDimensions },
      organization: ORGANIZATION,
    })
    const result = await tool.execute({})
    expect(getFilterDimensions).toHaveBeenCalledWith(ORGANIZATION)
    expect(result).toEqual({ dimensions: serveDimensions })
  })

  it('takes no input (empty object schema, extra keys rejected)', () => {
    const tool = buildDescribeFilterDimensionsTool({
      contacts: { getFilterDimensions: vi.fn(() => []) },
      organization: ORGANIZATION,
    })
    expect(tool.inputSchema.safeParse({}).success).toBe(true)
    expect(
      tool.inputSchema.safeParse({ organizationSlug: 'other-org' }).success,
    ).toBe(false)
  })
})
