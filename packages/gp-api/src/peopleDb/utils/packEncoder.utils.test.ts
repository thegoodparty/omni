import { describe, expect, it } from 'vitest'
import {
  DoorKnockingPackManifestSchema,
  MAX_PRECINCT_FILTER_VALUES,
  PACK_AGE_BUCKETS,
} from '@goodparty_org/contracts'
import {
  contactsMadeToBytes,
  excludedToSet,
  PackEncoder,
  PackRow,
  statusesToBytes,
} from './packEncoder.utils'

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
  County: null,
  Precinct: null,
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
  // A dim's plane read at its DECLARED width. Precinct is the only dim that
  // can be wide, and reading a u16 plane as u8 would silently return each
  // index's low byte.
  const plane = (key: string) => {
    const a = arrayByName.get(`dim:${key}`)!
    if (a.type === 'u16') {
      return Array.from(
        new Uint16Array(
          bytes.buffer.slice(a.byteOffset, a.byteOffset + a.elementCount * 2),
        ),
      )
    }
    return Array.from(
      bytes.subarray(a.byteOffset, a.byteOffset + a.elementCount),
    )
  }
  const arrayMeta = (name: string) => arrayByName.get(name)!
  return { manifest, u8, u32, f32, plane, arrayMeta }
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
    expect(dim('age')).toEqual(['26_34', '65_plus', 'Unknown', 'Unknown'])
    expect(dim('voterStatus')[0]).toBe('Super')
    // Three of these rows have no Language_Code at all. They used to shade as
    // 'Other' — a claim about their language made from its absence, and the
    // reason the map agreed with the filter's `OR ... IS NULL`.
    expect(dim('language')).toEqual([
      'Unknown',
      'Unknown',
      'Spanish',
      'Unknown',
    ])
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

  // Byte 0 carried 'Other' AND "no data" at once, so no fixture here ever
  // held a real non-English/Spanish code — the two cases were the same byte
  // and there was nothing to tell apart. All four now.
  it('gives a missing language its own byte, apart from a language we have', () => {
    const encoder = new PackEncoder(new Map())
    for (const code of [null, 'English', 'Spanish', 'Vietnamese']) {
      encoder.add(row({ Language_Code: code }))
    }

    const { manifest, u8 } = decode(encoder.toBuffer('2026-07-21T12:00:00Z'))
    const values = manifest.dims.find((d) => d.key === 'language')!.values

    expect(u8('dim:language').map((byte) => values[byte])).toEqual([
      'Unknown',
      'English',
      'Spanish',
      'Other',
    ])
    // Index 0 is "no data" in every other dim here; language was the one that
    // put a real value there.
    expect(values[0]).toBe('Unknown')
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

  // The `age` dim is the one whose vocabulary is derived (contracts'
  // PackAgeBuckets.ts) rather than written down here. These assert the encoder
  // actually ships that derivation, since a plane bucketed by one rule and
  // labelled by another is invisible until a candidate's count is wrong.
  describe('the age plane', () => {
    const bucketFor = (ages: Array<number | null>) => {
      const encoder = new PackEncoder(new Map())
      ages.forEach((age, index) =>
        encoder.add(row({ id: `p${index}`, hhKey: `h${index}`, Age_Int: age })),
      )
      const { manifest, u8 } = decode(encoder.toBuffer('2026-07-21T12:00:00Z'))
      const values = manifest.dims.find((d) => d.key === 'age')!.values
      return u8('dim:age').map((byte) => values[byte])
    }

    it('declares the derived buckets, in byte order', () => {
      const { manifest } = decode(
        new PackEncoder(new Map()).toBuffer('2026-07-21T12:00:00Z'),
      )
      expect(manifest.dims.find((d) => d.key === 'age')!.values).toEqual([
        ...PACK_AGE_BUCKETS,
      ])
    })

    // Every boundary from both sides. The three single-year buckets exist so
    // the retired keys' shared inclusive edges (25 is in both `age18_25` and
    // `age25_35`) stay expressible, and they are the ones most likely to be
    // quietly folded away by a later "simplification".
    it.each([
      [18, '18_24'],
      [24, '18_24'],
      [25, '25'],
      [26, '26_34'],
      [34, '26_34'],
      [35, '35'],
      [36, '36_49'],
      [49, '36_49'],
      [50, '50'],
      [51, '51_64'],
      [64, '51_64'],
      [65, '65_plus'],
      [103, '65_plus'],
    ])('buckets age %i as %s', (age, bucket) => {
      expect(bucketFor([age])).toEqual([bucket])
    })

    // No age filter matches an under-18 row (pre-registrant, bad data), so no
    // pack bucket may either — otherwise the map shades doors no list serves.
    it('reads a missing or under-18 age as Unknown', () => {
      expect(bucketFor([null, 0, 17])).toEqual([
        'Unknown',
        'Unknown',
        'Unknown',
      ])
    })
  })

  describe('the contactsMade plane', () => {
    const people = ['a', 'b', 'c'].map((id) => row({ id, hhKey: id }))

    const encode = (
      contactsMade: Parameters<typeof contactsMadeToBytes>[0],
    ) => {
      const encoder = new PackEncoder(
        new Map(),
        contactsMadeToBytes(contactsMade),
      )
      for (const person of people) encoder.add(person)
      return decode(encoder.toBuffer('2026-07-21T12:00:00Z'))
    }

    it('buckets the people gp-api named and leaves the rest at zero', () => {
      const { manifest, u8 } = encode([
        { personId: 'b', bucket: 3 },
        { personId: 'c', bucket: 5 },
      ])

      const values = manifest.dims.find((d) => d.key === 'contactsMade')!.values
      expect(u8('dim:contactsMade').map((byte) => values[byte])).toEqual([
        '0',
        '3',
        '5+',
      ])
    })

    // The two absences are different facts and the pack says which: an org
    // that has contacted nobody can be shaded ("0 prior contacts" is
    // everyone), while an org gp-api could not describe cannot be — and the
    // client's disclosure names the filter only in the second case.
    it('ships an all-zero plane for an organization with no outreach', () => {
      const { manifest, u8 } = encode([])

      expect(manifest.dims.map((d) => d.key)).toContain('contactsMade')
      expect(u8('dim:contactsMade')).toEqual([0, 0, 0])
    })

    it('omits the dim entirely when gp-api had no answer', () => {
      const { manifest } = encode(undefined)

      expect(manifest.dims.map((d) => d.key)).not.toContain('contactsMade')
      expect(manifest.arrays.map((a) => a.name)).not.toContain(
        'dim:contactsMade',
      )
    })

    // The cacheable half of the build is every plane above the two
    // campaign-specific ones, and it is identified positionally rather than by
    // name. A dim inserted between them would move bytes a per-district cache
    // means to reuse (docs/perf/voter-pack-headroom.md).
    it('keeps both campaign planes last, in order', () => {
      const { manifest } = encode([])

      expect(manifest.dims.slice(-2).map((d) => d.key)).toEqual([
        'canvassStatus',
        'contactsMade',
      ])
    })
  })
})

describe('the precinct plane', () => {
  const at = (county: string | null, precinct: string | null, id: string) =>
    row({ County: county, Precinct: precinct, id, lat: 41.9, lng: -87.65 })

  it('keys on the county and precinct together, and byte 0 is no county', () => {
    // A precinct number is unique only inside its county — one Texas
    // precinct string appears in 72 of them — so the pair is the identity
    // and the plane's vocabulary is `encodePrecinctPair`'s output, which is
    // exactly what `VoterFileFilter.precincts` stores.
    const encoder = new PackEncoder(statusesToBytes([]))
    encoder.add(
      at('Brevard', '300', '1'.repeat(8) + '-1111-1111-1111-111111111111'),
    )
    encoder.add(
      at('Brevard', '301', '2'.repeat(8) + '-1111-1111-1111-111111111111'),
    )
    // Same precinct NUMBER, different county: a different bucket.
    encoder.add(
      at('Orange', '300', '3'.repeat(8) + '-1111-1111-1111-111111111111'),
    )
    // No precinct on file but a known county. This is a real, selectable
    // bucket with an empty precinct side, NOT the no-data slot — every New
    // Hampshire voter is this case.
    encoder.add(
      at('Brevard', null, '4'.repeat(8) + '-1111-1111-1111-111111111111'),
    )
    // No county at all: nothing to pair, so the no-data slot.
    encoder.add(at(null, '300', '5'.repeat(8) + '-1111-1111-1111-111111111111'))

    const { manifest, plane } = decode(encoder.toBuffer('2026-07-21T12:00:00Z'))
    const dim = manifest.dims.find((d) => d.key === 'precinct')!

    expect(dim.values).toEqual([
      'Unknown',
      'Brevard|300',
      'Brevard|301',
      'Orange|300',
      'Brevard|',
    ])
    expect(plane('precinct')).toEqual([1, 2, 3, 4, 0])
  })

  it('stays one byte per person for a district that fits in one', () => {
    // p75 is 13-15 pairs, so the narrow case is the common one and a wide
    // plane on every build would be 600KB nobody needed.
    const encoder = new PackEncoder(statusesToBytes([]))
    for (let i = 0; i < 20; i++) {
      encoder.add(
        at(
          'Brevard',
          String(300 + i),
          `${String(i).padStart(8, '0')}-1111-1111-1111-111111111111`,
        ),
      )
    }
    const { arrayMeta, plane } = decode(
      encoder.toBuffer('2026-07-21T12:00:00Z'),
    )
    expect(arrayMeta('dim:precinct').type).toBe('u8')
    expect(plane('precinct')).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    )
  })

  it('widens past 256 pairs, and lands the wide plane on an even offset', () => {
    // A state-level race really does have more precincts than a byte can
    // index. Kings County CA alone has 579.
    const encoder = new PackEncoder(statusesToBytes([]))
    const total = 300
    for (let i = 0; i < total; i++) {
      encoder.add(
        at(
          'Brevard',
          String(i),
          `${String(i).padStart(8, '0')}-1111-1111-1111-111111111111`,
        ),
      )
    }
    const { arrayMeta, plane } = decode(
      encoder.toBuffer('2026-07-21T12:00:00Z'),
    )
    const meta = arrayMeta('dim:precinct')

    expect(meta.type).toBe('u16')
    // `new Uint16Array(buffer, byteOffset, n)` throws outright on an odd
    // offset, so this is the difference between a pack that decodes and one
    // that does not.
    expect(meta.byteOffset % 2).toBe(0)
    // And the indexes past 255 survive, which is the whole point.
    expect(plane('precinct').at(-1)).toBe(total)
  })

  it("keeps a district sitting exactly on the picker's ceiling", () => {
    // The cap counts REAL pairs, and index 0 is the no-county sentinel, so
    // the guard is `>` rather than `>=`. Off by one here silently drops the
    // plane for a district the picker would happily enumerate, which is the
    // invariant inverted: anything the picker can offer, the map can shade.
    const encoder = new PackEncoder(statusesToBytes([]))
    for (let i = 0; i < MAX_PRECINCT_FILTER_VALUES; i++) {
      encoder.add(
        at(
          'Brevard',
          String(i),
          `${String(i).padStart(8, '0')}-1111-1111-1111-111111111111`,
        ),
      )
    }
    const { manifest } = decode(encoder.toBuffer('2026-07-21T12:00:00Z'))
    const dim = manifest.dims.find((d) => d.key === 'precinct')

    expect(dim).toBeDefined()
    // Every real pair, plus the sentinel.
    expect(dim?.values.length).toBe(MAX_PRECINCT_FILTER_VALUES + 1)
  })

  it("drops the plane whole past the picker's own ceiling", () => {
    // Omitted rather than truncated, the way contactsMade is: a truncated
    // plane reads the overflow as some OTHER precinct, which shades a map
    // confidently wrong. An absent plane is the honest "cannot shade this",
    // and the create flow's unpreviewable-filter disclosure already says so.
    //
    // The ceiling is MAX_PRECINCT_FILTER_VALUES, the same number the picker
    // caps itself to, so the rule is "if the picker can offer it, the map
    // can shade it".
    const encoder = new PackEncoder(statusesToBytes([]))
    for (let i = 0; i <= MAX_PRECINCT_FILTER_VALUES; i++) {
      encoder.add(
        at(
          'Brevard',
          String(i),
          `${String(i).padStart(8, '0')}-1111-1111-1111-111111111111`,
        ),
      )
    }
    const { manifest } = decode(encoder.toBuffer('2026-07-21T12:00:00Z'))

    expect(manifest.dims.map((d) => d.key)).not.toContain('precinct')
    expect(manifest.arrays.map((a) => a.name)).not.toContain('dim:precinct')
    // The rest of the pack is still worth serving.
    expect(manifest.counts.people).toBe(MAX_PRECINCT_FILTER_VALUES + 1)
  })
})

describe('the knockable plane', () => {
  const person = (id: string) =>
    row({ id, lat: 41.9, lng: -87.65, hhKey: `hh-${id}` })

  const A = '11111111-1111-1111-1111-111111111111'
  const B = '22222222-2222-2222-2222-222222222222'

  it('marks the suppressed and leaves everyone else knockable', () => {
    // The encode is the INVERSE of every other plane's `?? 0`: the default
    // here is knockable, and byte 0 is reserved for the people no campaign
    // may knock. Getting that backwards would hide the whole district.
    const encoder = new PackEncoder(
      statusesToBytes([]),
      null,
      excludedToSet([A]),
    )
    encoder.add(person(A))
    encoder.add(person(B))

    const { manifest, u8 } = decode(encoder.toBuffer('2026-07-21T12:00:00Z'))
    const dim = manifest.dims.find((d) => d.key === 'knockable')

    expect(dim?.values).toEqual(['No', 'Yes'])
    expect(u8('dim:knockable')).toEqual([0, 1])
  })

  it('shades an organization that has flagged nobody', () => {
    // Empty is a fact the map can draw — everyone is knockable — and is not
    // the same as gp-api having no answer.
    const encoder = new PackEncoder(
      statusesToBytes([]),
      null,
      excludedToSet([]),
    )
    encoder.add(person(A))

    const { manifest, u8 } = decode(encoder.toBuffer('2026-07-21T12:00:00Z'))

    expect(manifest.dims.map((d) => d.key)).toContain('knockable')
    expect(u8('dim:knockable')).toEqual([1])
  })

  it('omits the plane when gp-api did not answer', () => {
    // Absent must not become a wall of "Yes": that claims every door is
    // open, which is the wrong way to be wrong about somebody who said
    // don't come back. The client reads a missing plane as "do not
    // suppress" and the frozen route still drops them.
    const encoder = new PackEncoder(
      statusesToBytes([]),
      null,
      excludedToSet(undefined),
    )
    encoder.add(person(A))

    const { manifest } = decode(encoder.toBuffer('2026-07-21T12:00:00Z'))

    expect(manifest.dims.map((d) => d.key)).not.toContain('knockable')
    expect(manifest.arrays.map((a) => a.name)).not.toContain('dim:knockable')
  })
})
