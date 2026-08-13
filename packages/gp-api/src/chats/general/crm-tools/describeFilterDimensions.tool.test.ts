import { describe, expect, it, vi } from 'vitest'
import type { Organization } from '../../../generated/prisma'
import {
  FILTER_DIMENSION_PROVENANCE_RULES,
  FILTER_DIMENSIONS,
} from '@/contacts/filterDimensions.catalog'
import {
  buildDescribeFilterDimensionsTool,
  type DescribeFilterDimensionsOutput,
} from './describeFilterDimensions.tool'

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

  // Mirrors the HS_SCORE_SEMANTICS pin on queryConstituentData.tool.ts: the
  // whole constant, not fragments, so partial pastes and drift both fail.
  it('carries the full provenance rules in its description', () => {
    const tool = buildDescribeFilterDimensionsTool({
      contacts: { getFilterDimensions: vi.fn(() => []) },
      organization: ORGANIZATION,
    })
    expect(tool.description).toContain(FILTER_DIMENSION_PROVENANCE_RULES)
  })

  // The D3-05 regression test: fails if a future serializer or `pick` drops
  // the field before it reaches the model.
  it('returns provenance on every dimension it hands the model', async () => {
    const getFilterDimensions = vi.fn(() => [...FILTER_DIMENSIONS])
    const tool = buildDescribeFilterDimensionsTool({
      contacts: { getFilterDimensions },
      organization: ORGANIZATION,
    })
    const result = (await tool.execute({})) as DescribeFilterDimensionsOutput
    expect(result.dimensions.length).toBeGreaterThan(0)
    expect(
      result.dimensions.every((d) => typeof d.provenance === 'string'),
    ).toBe(true)
  })

  // Win and Serve mandate opposite nouns for this data ("voters" vs
  // "constituents"); the shared rule text has to use neither.
  it('states the provenance rules without a mode-specific noun', () => {
    expect(FILTER_DIMENSION_PROVENANCE_RULES).not.toMatch(/voter/i)
    expect(FILTER_DIMENSION_PROVENANCE_RULES).not.toMatch(/constituent/i)
  })
})
