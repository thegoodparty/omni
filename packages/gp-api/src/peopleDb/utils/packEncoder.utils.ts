import {
  AGE_DIM_KEY,
  CONTACTS_MADE_BUCKETS,
  CONTACTS_MADE_DIM_KEY,
  DOOR_KNOCK_STATUSES,
  PACK_AGE_BUCKETS,
  encodeAgeBucket,
  DoorKnockingPackManifest,
  DoorKnockingPackRequest,
  INCOME_RANGE_MAPPING,
  KNOCKABLE_DIM_KEY,
  KNOCKABLE_VALUES,
  MAX_PRECINCT_FILTER_VALUES,
  PACK_DIM_WIDTHS,
  PEOPLE_FILTER_VALUE_ENUMS,
  PRECINCT_DIM_KEY,
  encodePrecinctPair,
} from '@goodparty_org/contracts'
import { VALUE_MAPPERS } from './valueMappers.util'
import {
  classifyPoliticalParty,
  RULED_POLITICAL_PARTIES,
} from './politicalParty.rules'

export type PackRow = {
  id: string
  lat: number
  lng: number
  hhKey: string
  Parties_Description: string | null
  Age_Int: number | null
  Gender: string | null
  Voter_Status: string | null
  Marital_Status: string | null
  Veteran_Status: string | null
  Presence_Of_Children: string | null
  Homeowner_Probability_Model: string | null
  Business_Owner: string | null
  Education_Of_Person: string | null
  Estimated_Income_Amount_Int: number | null
  Language_Code: string | null
  EthnicGroups_EthnicGroup1Desc: string | null
  County: string | null
  Precinct: string | null
  registered: boolean
  hasCellPhone: boolean
  hasLandline: boolean
}

const UNKNOWN = 'Unknown'

// Byte 0 is always the "no data" bucket; the rest are the filter enum's
// values in order. The raw-column spelling for each value comes from
// inverting VALUE_MAPPERS, so a pack byte can never disagree with what the
// corresponding list filter would match.
const invertMapper = (
  filterKey: keyof typeof PEOPLE_FILTER_VALUE_ENUMS,
  mapper: (value: string) => string | string[] | null,
): { values: string[]; rawToByte: Map<string, number> } => {
  const values = [UNKNOWN]
  const rawToByte = new Map<string, number>()
  for (const value of PEOPLE_FILTER_VALUE_ENUMS[filterKey]) {
    if (value === UNKNOWN) continue
    const raw = mapper(value)
    if (raw === null) continue
    // homeowner's 'Yes' maps to two raw values (ENG-10947's Homeowner/
    // Probable Home Owner fold), but the pack encodes one byte per person —
    // it can't represent an OR of two buckets under one wire value, so it
    // keeps its pre-fold behavior and inverts only the first (see
    // voterFilterPreview.ts's homeownerYes comment for the disclosed gap).
    const rawForByte = Array.isArray(raw) ? raw[0] : raw
    if (rawForByte === undefined) continue
    values.push(value)
    rawToByte.set(rawForByte, values.length - 1)
  }
  return { values, rawToByte }
}

const MAPPED_DIMS = [
  ['gender', 'gender', 'Gender'],
  ['maritalStatus', 'maritalStatus', 'Marital_Status'],
  ['veteranStatus', 'veteranStatus', 'Veteran_Status'],
  ['presenceOfChildren', 'presenceOfChildren', 'Presence_Of_Children'],
  ['homeowner', 'homeowner', 'Homeowner_Probability_Model'],
  ['educationLevel', 'educationLevel', 'Education_Of_Person'],
  ['ethnicity', 'ethnicity', 'EthnicGroups_EthnicGroup1Desc'],
] as const satisfies ReadonlyArray<
  readonly [string, keyof typeof VALUE_MAPPERS, keyof PackRow]
>

const INCOME_VALUES = [UNKNOWN, ...Object.keys(INCOME_RANGE_MAPPING)]
const INCOME_RANGES = Object.values(INCOME_RANGE_MAPPING)
const encodeIncome = (amount: number | null): number => {
  if (amount === null) return 0
  const index = INCOME_RANGES.findIndex(
    (range) =>
      amount >= range.min && (range.max === null || amount <= range.max),
  )
  return index === -1 ? 0 : index + 1
}

// Byte 0 used to be 'Other' AND the no-data slot at once, which is the pack's
// copy of buildLanguageFilter's `OR ... IS NULL`: a person with no
// Language_Code shaded as an Other-language speaker. 'Unknown' is its own
// byte now, so the map and the filter agree about who is which.
//
// UNKNOWN stays at index 0 to match every other dim here — an unset byte is
// "no data", not a real value.
//
// The comparison is exact, not case-folded, because buildLanguageFilter's SQL
// is (`= 'English'`). Normalizing here would put the map back out of step with
// the filter — a lowercase 'english' would shade English and still be filtered
// as Other — which is the disagreement this dim just stopped having.
const LANGUAGE_VALUES = [UNKNOWN, 'English', 'Spanish', 'Other']
const encodeLanguage = (code: string | null): number =>
  code === null ? 0 : code === 'English' ? 1 : code === 'Spanish' ? 2 : 3

const VOTER_STATUS_VALUES = [
  UNKNOWN,
  ...PEOPLE_FILTER_VALUE_ENUMS.voterStatus.filter((value) => value !== UNKNOWN),
]
// voterStatus filters compare the raw column directly — the enum values ARE
// the column vocabulary.
const VOTER_STATUS_BYTES = new Map(
  VOTER_STATUS_VALUES.map((value, index) => [value, index]),
)

const YES_NO = ['No', 'Yes']

class GrowableU8 {
  private array = new Uint8Array(64 * 1024)
  length = 0

  push(value: number): void {
    if (this.length === this.array.length) {
      const next = new Uint8Array(this.array.length * 2)
      next.set(this.array)
      this.array = next
    }
    this.array[this.length++] = value
  }

  view(): Uint8Array {
    return this.array.subarray(0, this.length)
  }
}

// The precinct plane's sibling. Every other dim's vocabulary is a closed enum
// known before the scan, so a byte is always enough; precinct's is the
// district's own pairs, discovered row by row, and a state-level race has
// more than 256 of them. Accumulated wide and NARROWED back to u8 in
// `toBuffer` when the district turned out to fit, which is the common case:
// p75 is 13-15 pairs, so almost every build still pays one byte per person.
class GrowableU16 {
  private array = new Uint16Array(64 * 1024)
  length = 0

  push(value: number): void {
    if (this.length === this.array.length) {
      const next = new Uint16Array(this.array.length * 2)
      next.set(this.array)
      this.array = next
    }
    this.array[this.length++] = value
  }

  view(): Uint16Array {
    return this.array.subarray(0, this.length)
  }
}

type DimPlane = {
  key: string
  values: string[]
  encode: (row: PackRow) => number
  bytes: GrowableU8 | GrowableU16
  // Set when the dim's vocabulary outgrew what the pack will carry. The plane
  // is dropped whole in `toBuffer` rather than truncated: a truncated plane
  // reads the overflow as some OTHER value, where an absent one is an honest
  // "cannot shade this" the create flow already knows how to say.
  dropped?: boolean
}

const ELEMENT_BYTES = { f32: 4, u32: 4, u16: 2, u8: 1 } as const

// A dim's plane is as narrow as its vocabulary allows. Only precinct can be
// wide, and only in a district with more than 256 pairs — p75 is 13-15, so
// the wide case is the exception rather than the rule.
const planeType = (dim: DimPlane): 'u8' | 'u16' =>
  dim.values.length > PACK_DIM_WIDTHS.u8 ? 'u16' : 'u8'

// The plane as bytes for the wire. Precinct accumulates wide because its
// vocabulary is not known until the last row has been read; by here it is,
// so a district that turned out to fit in a byte pays a byte. The narrowing
// is one element per person, which is nothing beside the scan that produced
// them.
const planeBytes = (dim: DimPlane): Uint8Array => {
  const view = dim.bytes.view()
  if (view instanceof Uint8Array) return view
  if (planeType(dim) === 'u16') {
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
  }
  const narrowed = new Uint8Array(view.length)
  for (let index = 0; index < view.length; index++) {
    narrowed[index] = view[index] ?? 0
  }
  return narrowed
}

// personId -> canvass status byte (index into DOOR_KNOCK_STATUSES).
export type PackStatuses = Map<string, number>

export const statusesToBytes = (
  entries: Array<{ personId: string; status: string }>,
): PackStatuses => {
  const byStatus = new Map(
    DOOR_KNOCK_STATUSES.map((status, index) => [status as string, index]),
  )
  return new Map(
    entries.map(({ personId, status }) => [
      personId,
      byStatus.get(status) ?? 0,
    ]),
  )
}

// personId -> contacts-made bucket byte (index into CONTACTS_MADE_BUCKETS).
// `null` is "gp-api could not answer", and the encoder omits the plane for it
// — distinct from an empty map, which is an organization that has contacted
// nobody and whose plane is a legitimate wall of bucket 0.
export type PackContactsMade = Map<string, number> | null

export const contactsMadeToBytes = (
  entries: DoorKnockingPackRequest['contactsMade'],
): PackContactsMade =>
  entries === undefined
    ? null
    : new Map(entries.map(({ personId, bucket }) => [personId, bucket]))

// The people every server-side evaluation removes before it counts anything.
// `null` is "gp-api did not answer" and omits the plane; an empty set is an
// organization that has flagged nobody, which is a real fact the map can
// shade. Same two-state convention as `contactsMadeToBytes`, and for a
// sharper reason: a plane of yeses claims every door is open, which is the
// wrong way to be wrong about somebody who said don't come back.
export type PackExcluded = Set<string> | null

export const excludedToSet = (personIds: string[] | undefined): PackExcluded =>
  personIds === undefined ? null : new Set(personIds)

export class PackEncoder {
  // Keyed lat -> lng -> dot rather than on a `${lat}|${lng}` string. Building
  // that string was 261ms of a 628k-row build — the single most expensive
  // thing the encoder did, more than every dimension plane put together —
  // because it allocates a string per person to look up a number. Two numeric
  // Map probes cost 85ms and dedupe identically: the coordinates are already
  // parsed float8s, so equal coordinates are equal numbers.
  //
  // A single numeric key would be faster still, and is not available: packing
  // two 1e6-scaled coordinates into one float64 needs ~56 bits of mantissa and
  // there are 53, so the product silently collides — and a dot-key collision
  // merges two unrelated rooftops into one door.
  private readonly dotIndex = new Map<number, Map<number, number>>()
  private dotCount = 0
  private readonly householdIndex = new Map<string, number>()
  private positions = new Float32Array(128 * 1024)
  private positionsLength = 0
  private personToHousehold = new Uint32Array(64 * 1024)
  private householdToDot = new Uint32Array(64 * 1024)
  private peopleCount = 0
  private readonly dims: DimPlane[]

  constructor(
    statusByPersonId: PackStatuses,
    contactsMadeByPersonId: PackContactsMade = null,
    excludedPersonIds: PackExcluded = null,
  ) {
    const mapped: DimPlane[] = MAPPED_DIMS.map(([key, mapperKey, column]) => {
      const { values, rawToByte } = invertMapper(
        mapperKey,
        VALUE_MAPPERS[mapperKey],
      )
      return {
        key,
        values,
        encode: (row: PackRow) => {
          const raw = row[column]
          return typeof raw === 'string' ? (rawToByte.get(raw) ?? 0) : 0
        },
        bytes: new GrowableU8(),
      }
    })
    // Party classifies by the shared exact-value rules: the bucket must match
    // exactly the rows the canonical-party list filter selects. Display-'Other'
    // rows (non-blank, unknown value) land in byte 0 alongside null/blank.
    const partyValues = [UNKNOWN, ...RULED_POLITICAL_PARTIES]
    const partyBytes = new Map(partyValues.map((value, i) => [value, i]))
    const party: DimPlane = {
      key: 'party',
      values: partyValues,
      encode: (row) => {
        const raw = row.Parties_Description
        if (typeof raw !== 'string' || raw === '') return 0
        return partyBytes.get(classifyPoliticalParty(raw)) ?? 0
      },
      bytes: new GrowableU8(),
    }
    // Precinct, and the only dim whose vocabulary is LEARNED rather than
    // declared. Every other plane maps a closed enum, so its values exist
    // before the first row; a district's precincts are whatever is in the
    // district, so the list is built as the scan runs and each new pair takes
    // the next index. That works precisely because the encoder is a single
    // forward pass — the value list and the plane are written together.
    //
    // Byte 0 is the no-data slot the other dims use, and it means "no county
    // on file", which is not the same thing as no PRECINCT on file: a voter
    // whose county is known and precinct is not has a real, selectable pair
    // with an empty precinct side, exactly as the picker offers it. New
    // Hampshire is the case that makes this matter, where every voter has a
    // null precinct and a perfectly good county.
    const precinctValues: string[] = [UNKNOWN]
    const precinctBytes = new Map<string, number>()
    const precinct: DimPlane = {
      key: PRECINCT_DIM_KEY,
      values: precinctValues,
      encode: (row) => {
        const county = row.County ?? ''
        if (county === '') return 0
        const pair = encodePrecinctPair(county, row.Precinct ?? '')
        const seen = precinctBytes.get(pair)
        if (seen !== undefined) return seen
        // `>` and not `>=`, because index 0 is the sentinel and the cap
        // counts REAL pairs. At `length === MAX` there are MAX - 1 of those
        // and the one being added is the MAXth, which the picker would
        // offer — rejecting it there breaks the invariant this cap exists
        // to hold, that anything the picker can offer the map can shade.
        if (precinctValues.length > MAX_PRECINCT_FILTER_VALUES) {
          // Past the picker's own ceiling. Mark and keep going rather than
          // throwing: the rest of the pack is still worth serving, and the
          // plane leaves in `toBuffer`.
          precinct.dropped = true
          return 0
        }
        const next = precinctValues.length
        precinctValues.push(pair)
        precinctBytes.set(pair, next)
        return next
      },
      bytes: new GrowableU16(),
    }

    this.dims = [
      party,
      ...mapped,
      {
        // The one dim whose vocabulary is derived rather than declared: its
        // buckets are cut at every boundary either generation of saved-list
        // age key uses, so every key is an exact union of them and none is
        // approximated. See contracts' PackAgeBuckets.ts — changing that
        // table re-cuts these and is a PACK_FORMAT_REVISION bump.
        key: AGE_DIM_KEY,
        values: [...PACK_AGE_BUCKETS],
        encode: (row) => encodeAgeBucket(row.Age_Int),
        bytes: new GrowableU8(),
      },
      {
        key: 'voterStatus',
        values: VOTER_STATUS_VALUES,
        encode: (row) =>
          row.Voter_Status
            ? (VOTER_STATUS_BYTES.get(row.Voter_Status) ?? 0)
            : 0,
        bytes: new GrowableU8(),
      },
      {
        key: 'income',
        values: INCOME_VALUES,
        encode: (row) => encodeIncome(row.Estimated_Income_Amount_Int),
        bytes: new GrowableU8(),
      },
      {
        key: 'language',
        values: LANGUAGE_VALUES,
        encode: (row) => encodeLanguage(row.Language_Code),
        bytes: new GrowableU8(),
      },
      {
        // Same semantics as the businessOwner filter: any value = Yes.
        key: 'businessOwner',
        values: [UNKNOWN, 'Yes'],
        encode: (row) => (row.Business_Owner !== null ? 1 : 0),
        bytes: new GrowableU8(),
      },
      {
        key: 'registered',
        values: YES_NO,
        encode: (row) => (row.registered ? 1 : 0),
        bytes: new GrowableU8(),
      },
      {
        key: 'hasCellPhone',
        values: YES_NO,
        encode: (row) => (row.hasCellPhone ? 1 : 0),
        bytes: new GrowableU8(),
      },
      {
        key: 'hasLandline',
        values: YES_NO,
        encode: (row) => (row.hasLandline ? 1 : 0),
        bytes: new GrowableU8(),
      },
      // District-scoped, so it sits with the district dims and IN FRONT of
      // the per-organization planes below: everything above `canvassStatus`
      // is a pure function of the district, which is the property a cached
      // shared build would rest on.
      precinct,
      {
        key: 'canvassStatus',
        values: [...DOOR_KNOCK_STATUSES],
        encode: (row) => statusByPersonId.get(row.id) ?? 0,
        bytes: new GrowableU8(),
      },
    ]
    // The second campaign-specific plane, and the only conditional one. It is
    // pushed after the district-scoped dims for the same reason canvassStatus
    // is: everything above this line is a pure function of the district, so a
    // cached shared build can be copied and only the tail rewritten.
    //
    // Omitted rather than zero-filled when gp-api has no answer — a plane of
    // zeros claims every person has never been contacted, which is a stronger
    // and more wrong statement than having no plane at all. Absent, the dim
    // never reaches the manifest, and the client's own unpreviewable-filter
    // machinery names the filter it cannot shade.
    if (contactsMadeByPersonId) {
      this.dims.push({
        key: CONTACTS_MADE_DIM_KEY,
        values: [...CONTACTS_MADE_BUCKETS],
        encode: (row) => contactsMadeByPersonId.get(row.id) ?? 0,
        bytes: new GrowableU8(),
      })
    }

    // The third per-organization plane, and the only one that is not a
    // filter. Nothing selects it: `runFilter` and `polygonStats` read it as
    // an unconditional mask, because do-not-knock and not-a-voter are
    // suppression rather than criteria and every server-side evaluation
    // already applies them. That is also what keeps this out of the filter
    // catalog, which is the review ADR 0007 deferred.
    //
    // Note the encode is the inverse of the other planes' `?? 0`: the
    // DEFAULT here is knockable, and byte 0 is reserved for the people who
    // are not.
    if (excludedPersonIds) {
      this.dims.push({
        key: KNOCKABLE_DIM_KEY,
        values: [...KNOCKABLE_VALUES],
        encode: (row) => (excludedPersonIds.has(row.id) ? 0 : 1),
        bytes: new GrowableU8(),
      })
    }
  }

  add(row: PackRow): void {
    let atLat = this.dotIndex.get(row.lat)
    if (atLat === undefined) {
      atLat = new Map<number, number>()
      this.dotIndex.set(row.lat, atLat)
    }
    let dot = atLat.get(row.lng)
    if (dot === undefined) {
      dot = this.dotCount++
      atLat.set(row.lng, dot)
      if (this.positionsLength + 2 > this.positions.length) {
        const next = new Float32Array(this.positions.length * 2)
        next.set(this.positions)
        this.positions = next
      }
      this.positions[this.positionsLength++] = row.lng
      this.positions[this.positionsLength++] = row.lat
    }
    let household = this.householdIndex.get(row.hhKey)
    if (household === undefined) {
      household = this.householdIndex.size
      this.householdIndex.set(row.hhKey, household)
      if (household === this.householdToDot.length) {
        const next = new Uint32Array(this.householdToDot.length * 2)
        next.set(this.householdToDot)
        this.householdToDot = next
      }
      this.householdToDot[household] = dot
    }
    if (this.peopleCount === this.personToHousehold.length) {
      const next = new Uint32Array(this.personToHousehold.length * 2)
      next.set(this.personToHousehold)
      this.personToHousehold = next
    }
    this.personToHousehold[this.peopleCount++] = household
    for (const dim of this.dims) {
      dim.bytes.push(dim.encode(row))
    }
  }

  // Layout: [u32 LE manifest length][manifest JSON padded to 4 bytes]
  // [positions f32][personToHousehold u32][householdToDot u32][u8 planes].
  // Manifest offsets depend on the manifest's own serialized length, so the
  // serialization runs to a fixpoint (offset digit counts stabilize within
  // a few iterations).
  toBuffer(generatedAt: string): Buffer {
    const counts = {
      people: this.peopleCount,
      households: this.householdIndex.size,
      dots: this.dotCount,
    }
    const pad4 = (n: number) => Math.ceil(n / 4) * 4

    // Offsets are computed FROM dataStart, and dataStart only grows until
    // the serialized manifest (whose offsets were computed from it) fits
    // inside it — so the written manifest is always consistent with the
    // actual layout. Monotone growth converges in 2-3 iterations; the guard
    // turns a would-be silent corruption into a hard error.
    // What survives to the wire, widest plane first.
    //
    // Dropping is the vocabulary-overflow path (see `DimPlane.dropped`). The
    // ORDER is what keeps a u16 plane 2-byte aligned without a padding
    // scheme: `dataStart` is 4-aligned and every core array is a whole
    // number of 4-byte elements, so the first dim starts aligned, and a u16
    // plane is `people * 2` bytes, which leaves the next one aligned too.
    // Put a u8 plane in front of a u16 one and an odd person count lands the
    // u16 view on an odd offset, where the browser's
    // `new Uint16Array(buffer, byteOffset, n)` throws outright. `sort` is
    // stable, so dims keep their relative order within each width — which
    // matters because the district-scoped dims deliberately precede the
    // per-organization ones.
    const dims = this.dims
      .filter((dim) => !dim.dropped)
      .sort(
        (a, b) =>
          Number(planeType(b) === 'u16') - Number(planeType(a) === 'u16'),
      )

    const buildManifestJson = (dataStart: number): string => {
      const arrays: DoorKnockingPackManifest['arrays'] = []
      let offset = dataStart
      const push = (
        name: string,
        type: 'f32' | 'u32' | 'u16' | 'u8',
        count: number,
      ) => {
        arrays.push({ name, type, byteOffset: offset, elementCount: count })
        offset += count * ELEMENT_BYTES[type]
      }
      push('positions', 'f32', this.positionsLength)
      push('personToHousehold', 'u32', counts.people)
      push('householdToDot', 'u32', counts.households)
      for (const dim of dims) {
        push(`dim:${dim.key}`, planeType(dim), counts.people)
      }
      const manifest: DoorKnockingPackManifest = {
        // The byte FRAMING, unchanged by the language split: still one u8 per
        // person per dim. What changed is that dim's vocabulary, which is
        // PACK_FORMAT_REVISION's axis and travels in `dims[].values` below.
        version: 1,
        generatedAt,
        counts,
        dims: dims.map((dim) => ({ key: dim.key, values: dim.values })),
        arrays,
      }
      return JSON.stringify(manifest)
    }

    let dataStart = 4
    let manifestJson = ''
    for (let iteration = 0; ; iteration++) {
      if (iteration >= 8) {
        throw new Error('pack manifest offsets did not converge')
      }
      manifestJson = buildManifestJson(dataStart)
      const needed = 4 + pad4(Buffer.byteLength(manifestJson))
      if (needed <= dataStart) break
      dataStart = needed
    }

    const manifestBytes = Buffer.byteLength(manifestJson)
    const total =
      dataStart +
      this.positionsLength * 4 +
      counts.people * 4 +
      counts.households * 4 +
      dims.reduce(
        (sum, dim) => sum + counts.people * ELEMENT_BYTES[planeType(dim)],
        0,
      )

    const buffer = Buffer.alloc(total)
    buffer.writeUInt32LE(manifestBytes, 0)
    buffer.write(manifestJson, 4, 'utf8')
    let offset = dataStart
    const copy = (view: Uint8Array) => {
      buffer.set(view, offset)
      offset += view.byteLength
    }
    copy(new Uint8Array(this.positions.buffer, 0, this.positionsLength * 4))
    copy(new Uint8Array(this.personToHousehold.buffer, 0, counts.people * 4))
    copy(new Uint8Array(this.householdToDot.buffer, 0, counts.households * 4))
    for (const dim of dims) {
      if (planeType(dim) === 'u16' && offset % 2 !== 0) {
        // Unreachable while `dims` is ordered widest-first, and a hard error
        // rather than a silent one if that ever stops being true: an odd
        // offset makes the client's `new Uint16Array(buffer, offset, n)`
        // throw, which surfaces as a pack that fails to decode at all.
        throw new Error(`u16 plane "${dim.key}" would land on an odd offset`)
      }
      copy(planeBytes(dim))
    }
    return buffer
  }
}
