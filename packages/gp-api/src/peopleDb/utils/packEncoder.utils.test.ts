import { describe, expect, it } from 'vitest'
import { DoorKnockingPackManifestSchema } from '@goodparty_org/contracts'
import { PackEncoder, PackRow, statusesToBytes } from './packEncoder.utils'

const row = (overrides: Partial<PackRow>): PackRow => ({
  id: '11111111-1111-1111-1111-111111111111',
  lat: 41.9,
  lng: -87.65,
  hhKey: '1200 W ELM ST|SPRINGFIELD|IL|62704',
  Parties_Description: null,
  Age_Int: null,
  Gender: null,
  Voter_Status: null,
  Marital_Status: null,
  Veteran_Status: null,
  Presence_Of_Children: null,
  Homeowner_Probability_Model: null,
  Business_Owner: null,
  Education_Of_Person: null,
  Estimated_Income_Amount_Int: null,
  Language_Code: null,
  EthnicGroups_EthnicGroup1Desc: null,
  registered: false,
  hasCellPhone: false,
  hasLandline: false,
  ...overrides,
})

const decode = (buffer: Buffer) => {
  const manifestBytes = buffer.readUInt32LE(0)
  const manifest = DoorKnockingPackManifestSchema.parse(
    JSON.parse(buffer.subarray(4, 4 + manifestBytes).toString('utf8')),
  )
  const bytes = new Uint8Array(buffer)
  const arrayByName = new Map(manifest.arrays.map((a) => [a.name, a]))
  const u8 = (name: string) => {
    const a = arrayByName.get(name)!
    return Array.from(
      bytes.subarray(a.byteOffset, a.byteOffset + a.elementCount),
    )
  }
  const u32 = (name: string) => {
    const a = arrayByName.get(name)!
    return Array.from(
      new Uint32Array(
        bytes.buffer.slice(a.byteOffset, a.byteOffset + a.elementCount * 4),
      ),
    )
  }
  const f32 = (name: string) => {
    const a = arrayByName.get(name)!
    return Array.from(
      new Float32Array(
        bytes.buffer.slice(a.byteOffset, a.byteOffset + a.elementCount * 4),
      ),
    )
  }
  return { manifest, u8, u32, f32 }
}

describe('PackEncoder', () => {
  it('round-trips a coherent, schema-valid pack', () => {
    const encoder = new PackEncoder(
      statusesToBytes([
        {
          personId: '22222222-2222-2222-2222-222222222222',
          status: 'supporter',
        },
      ]),
    )
    // Two people in one household (one dot), a second household at the SAME
    // coordinates (same dot), and a third person elsewhere.
    encoder.add(
      row({
        id: '11111111-1111-1111-1111-111111111111',
        Parties_Description: 'Non-Partisan',
        Age_Int: 30,
        Voter_Status: 'Super',
        registered: true,
      }),
    )
    encoder.add(
      row({
        id: '22222222-2222-2222-2222-222222222222',
        Parties_Description: 'Democratic',
        Age_Int: 71,
        hasCellPhone: true,
      }),
    )
    encoder.add(
      row({
        id: '33333333-3333-3333-3333-333333333333',
        hhKey: '1200 W ELM ST APT 2|SPRINGFIELD|IL|62704',
        Language_Code: 'Spanish',
      }),
    )
    encoder.add(
      row({
        id: '44444444-4444-4444-4444-444444444444',
        lat: 41.91,
        lng: -87.66,
        hhKey: '9 OAK AVE|SPRINGFIELD|IL|62704',
        Estimated_Income_Amount_Int: 60_000,
      }),
    )

    const { manifest, u8, u32, f32 } = decode(
      encoder.toBuffer('2026-07-21T12:00:00Z'),
    )

    expect(manifest.counts).toEqual({ people: 4, households: 3, dots: 2 })
    expect(u32('personToHousehold')).toEqual([0, 0, 1, 2])
    expect(u32('householdToDot')).toEqual([0, 0, 1])
    const positions = f32('positions')
    expect(positions[0]).toBeCloseTo(-87.65, 4)
    expect(positions[1]).toBeCloseTo(41.9, 4)

    const dim = (key: string) => {
      const values = manifest.dims.find((d) => d.key === key)!.values
      return u8(`dim:${key}`).map((byte) => values[byte])
    }
    // 'Non-Partisan' is the raw spelling the Independent FILTER matches —
    // the inversion keeps pack bytes and list filters in lockstep.
    expect(dim('party')).toEqual([
      'Independent',
      'Democratic',
      'Unknown',
      'Unknown',
    ])
    expect(dim('age')).toEqual(['25_35', '50_plus', 'Unknown', 'Unknown'])
    expect(dim('voterStatus')[0]).toBe('Super')
    expect(dim('language')).toEqual(['Other', 'Other', 'Spanish', 'Other'])
    expect(dim('income')[3]).toBe('$50k - $75k')
    expect(dim('registered')).toEqual(['Yes', 'No', 'No', 'No'])
    expect(dim('hasCellPhone')[1]).toBe('Yes')
    expect(dim('canvassStatus')).toEqual([
      'unknown',
      'supporter',
      'unknown',
      'unknown',
    ])
  })

  it('keeps f32/u32 arrays 4-byte aligned regardless of manifest length', () => {
    const encoder = new PackEncoder(new Map())
    encoder.add(row({}))
    const buffer = encoder.toBuffer('2026-07-21T12:00:00.123Z')
    const { manifest } = decode(buffer)
    for (const array of manifest.arrays) {
      if (array.type !== 'u8') {
        expect(array.byteOffset % 4).toBe(0)
      }
    }
  })

  it('an empty district still produces a valid pack', () => {
    const encoder = new PackEncoder(new Map())
    const { manifest } = decode(encoder.toBuffer('2026-07-21T12:00:00Z'))
    expect(manifest.counts).toEqual({ people: 0, households: 0, dots: 0 })
  })

  // Two rooftops that agree to six decimals and differ past them are two
  // houses, and merging them puts a canvasser at the wrong door. The dot index
  // is keyed on the coordinates themselves for this reason: any scheme that
  // packs a pair of scaled coordinates into one number runs out of mantissa
  // (~56 bits needed, 53 available) and collides silently.
  it('keeps rooftops that differ past six decimals apart', () => {
    const encoder = new PackEncoder(new Map())
    encoder.add(row({ id: 'a', lat: 41.9000001, lng: -87.65, hhKey: 'A' }))
    encoder.add(row({ id: 'b', lat: 41.9000002, lng: -87.65, hhKey: 'B' }))
    // Same latitude, different longitude: the second half of the key has to
    // separate them too.
    encoder.add(row({ id: 'c', lat: 41.9000001, lng: -87.6500001, hhKey: 'C' }))
    // And an exact repeat of the first is the same dot, not a third one.
    encoder.add(row({ id: 'd', lat: 41.9000001, lng: -87.65, hhKey: 'D' }))

    const { manifest, u32 } = decode(encoder.toBuffer('2026-07-21T12:00:00Z'))

    expect(manifest.counts.dots).toBe(3)
    expect(u32('householdToDot')).toEqual([0, 1, 2, 0])
  })
})
