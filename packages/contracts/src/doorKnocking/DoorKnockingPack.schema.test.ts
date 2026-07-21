import { describe, expect, it } from 'vitest'
import { DoorKnockingPackManifestSchema } from './DoorKnockingPack.schema'
import { BboxSchema } from '../shared/Bbox.schema'
import { DoorKnockingEvaluateRequestSchema } from './DoorKnockingEvaluation.schema'

const validManifest = {
  version: 1,
  generatedAt: '2026-07-20T12:00:00Z',
  counts: { people: 100, households: 60, dots: 50 },
  dims: [{ key: 'party', values: ['Unknown', 'Democratic', 'Republican'] }],
  arrays: [
    { name: 'positions', type: 'f32', byteOffset: 512, elementCount: 100 },
    {
      name: 'personToHousehold',
      type: 'u32',
      byteOffset: 912,
      elementCount: 100,
    },
    {
      name: 'householdToDot',
      type: 'u32',
      byteOffset: 1312,
      elementCount: 60,
    },
    { name: 'dim:party', type: 'u8', byteOffset: 1552, elementCount: 100 },
  ],
}

describe('DoorKnockingPackManifestSchema', () => {
  it('accepts a coherent manifest', () => {
    expect(() =>
      DoorKnockingPackManifestSchema.parse(validManifest),
    ).not.toThrow()
  })

  it('rejects a manifest missing a core array', () => {
    const manifest = {
      ...validManifest,
      arrays: validManifest.arrays.filter((a) => a.name !== 'positions'),
    }
    expect(() => DoorKnockingPackManifestSchema.parse(manifest)).toThrow(
      /missing core array .+positions/,
    )
  })

  it('rejects a dim without a matching u8 byte plane', () => {
    const manifest = {
      ...validManifest,
      dims: [...validManifest.dims, { key: 'age', values: ['18_25'] }],
    }
    expect(() => DoorKnockingPackManifestSchema.parse(manifest)).toThrow(
      /dim .+age.+ needs a u8 array/,
    )
  })

  it('rejects a dim whose byte plane is not u8', () => {
    const manifest = {
      ...validManifest,
      arrays: validManifest.arrays.map((a) =>
        a.name === 'dim:party' ? { ...a, type: 'u32' } : a,
      ),
    }
    expect(() => DoorKnockingPackManifestSchema.parse(manifest)).toThrow(
      /dim .+party.+ needs a u8 array/,
    )
  })
})

describe('BboxSchema', () => {
  it('rejects min exceeding max', () => {
    expect(() =>
      BboxSchema.parse({ minLat: 42, maxLat: 41, minLng: -88, maxLng: -87 }),
    ).toThrow(/bbox min must not exceed max/)
  })

  it('rejects out-of-range coordinates', () => {
    expect(() =>
      BboxSchema.parse({ minLat: -91, maxLat: 41, minLng: -88, maxLng: -87 }),
    ).toThrow()
  })
})

describe('DoorKnockingEvaluateRequestSchema', () => {
  const base = {
    districtId: '457a1cd7-4184-f823-49d3-f207af693521',
    bbox: { minLat: 41.8, maxLat: 41.9, minLng: -87.7, maxLng: -87.6 },
    maxPeople: 5000,
  }

  it('accepts a request without filters', () => {
    expect(() => DoorKnockingEvaluateRequestSchema.parse(base)).not.toThrow()
  })

  it('rejects unknown keys (strict)', () => {
    expect(() =>
      DoorKnockingEvaluateRequestSchema.parse({ ...base, limit: 10 }),
    ).toThrow()
  })

  it('accepts the people-api filter grammar', () => {
    const request = {
      ...base,
      filters: {
        voterStatus: { in: ['Super', 'Likely'] },
        ageInt: { _or: [{ gte: 18, lte: 25 }, { gte: 65 }] },
        id: { notIn: ['11111111-1111-1111-1111-111111111111'] },
      },
    }
    expect(() => DoorKnockingEvaluateRequestSchema.parse(request)).not.toThrow()
  })

  it('rejects an empty _or array (would silently disable the filter)', () => {
    const request = { ...base, filters: { ageInt: { _or: [] } } }
    expect(() => DoorKnockingEvaluateRequestSchema.parse(request)).toThrow()
  })

  it('rejects an _or range with neither gte nor lte', () => {
    const request = { ...base, filters: { ageInt: { _or: [{}] } } }
    expect(() => DoorKnockingEvaluateRequestSchema.parse(request)).toThrow()
  })
})
