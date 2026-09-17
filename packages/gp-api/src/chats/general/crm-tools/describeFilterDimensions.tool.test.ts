import { describe, expect, it, vi } from 'vitest'
import type { Organization } from '../../../generated/prisma'
import {
  FILTER_DIMENSION_PROVENANCE_RULES,
  FILTER_DIMENSIONS,
} from '@/contacts/filterDimensions.catalog'
import { DATA_SOURCE_ROUTING_RULES } from '@/llm/tools/dataSourceRouting'
import {
  buildDescribeFilterDimensionsTool,
  type DescribeFilterDimensionsOutput,
} from './describeFilterDimensions.tool'

const ORGANIZATION = { slug: 'eo-council' } as Organization

const isDescribeFilterDimensionsOutput = (
  value: unknown,
): value is DescribeFilterDimensionsOutput =>
  typeof value === 'object' && value !== null && 'dimensions' in value

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
    const result = await tool.execute({})
    if (!isDescribeFilterDimensionsOutput(result)) {
      throw new Error('expected a dimensions payload')
    }
    expect(result.dimensions.length).toBeGreaterThan(0)
    // undefined covers children/languageCodes, deliberately unclassified —
    // see UNCLASSIFIED_PROVENANCE_DIMENSIONS in filterDimensions.catalog.test.ts
    expect(new Set(result.dimensions.map((d) => d.provenance))).toEqual(
      new Set(['observed', 'modeled', 'derived', undefined]),
    )
  })

  // Win and Serve mandate opposite nouns for this data ("voters" vs
  // "constituents"); the shared rule text has to use neither.
  it('states the provenance rules without a mode-specific noun', () => {
    expect(FILTER_DIMENSION_PROVENANCE_RULES).not.toMatch(/voter/i)
    expect(FILTER_DIMENSION_PROVENANCE_RULES).not.toMatch(/constituent/i)
  })

  it('carries the cross-catalog routing rules in its description', () => {
    const tool = buildDescribeFilterDimensionsTool({
      contacts: { getFilterDimensions: vi.fn(() => []) },
      organization: ORGANIZATION,
    })
    expect(tool.description).toContain(DATA_SOURCE_ROUTING_RULES)
  })
})
