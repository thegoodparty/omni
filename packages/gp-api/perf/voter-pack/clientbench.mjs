// Client-side cost of a production-sized voter pack.
//
// Standalone on purpose: it reproduces the webapp's pack layout and copies the
// hot functions verbatim from
// packages/gp-webapp/app/dashboard/door-knocking/native/{packDecoder,filterEngine,VoterMapCanvas}.ts
// so no bundler or node_modules are needed. Run with plain `node`.

const PEOPLE = Number(process.env.PEOPLE ?? 620_000)
const HOUSEHOLDS = Number(process.env.HOUSEHOLDS ?? 290_000)
const DOTS = Number(process.env.DOTS ?? 220_000)

// 17 planes, matching PackEncoder's dim list and its bucket counts.
const DIMS = [
  ['party', 8],
  ['gender', 3],
  ['maritalStatus', 3],
  ['veteranStatus', 2],
  ['presenceOfChildren', 3],
  ['homeowner', 3],
  ['educationLevel', 5],
  ['ethnicity', 8],
  ['age', 5],
  ['voterStatus', 5],
  ['income', 9],
  ['language', 3],
  ['businessOwner', 2],
  ['registered', 2],
  ['hasCellPhone', 2],
  ['hasLandline', 2],
  ['canvassStatus', 7],
]

let seed = 0x2f6e2b1
const rnd = () => {
  seed ^= seed << 13
  seed ^= seed >>> 17
  seed ^= seed << 5
  return (seed >>> 0) / 0x100000000
}

const buildPackBuffer = () => {
  const pad4 = (n) => Math.ceil(n / 4) * 4
  const counts = { people: PEOPLE, households: HOUSEHOLDS, dots: DOTS }
  const buildManifestJson = (dataStart) => {
    const arrays = []
    let offset = dataStart
    const push = (name, type, count) => {
      arrays.push({ name, type, byteOffset: offset, elementCount: count })
      offset += count * (type === 'u8' ? 1 : 4)
    }
    push('positions', 'f32', DOTS * 2)
    push('personToHousehold', 'u32', PEOPLE)
    push('householdToDot', 'u32', HOUSEHOLDS)
    for (const [key, n] of DIMS) {
      push(`dim:${key}`, 'u8', PEOPLE)
      void n
    }
    return JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      counts,
      dims: DIMS.map(([key, n]) => ({
        key,
        values: Array.from({ length: n }, (_, i) =>
          i === 0 ? 'Unknown' : `v${i}`,
        ),
      })),
      arrays,
    })
  }
  let dataStart = 4
  let manifestJson = ''
  for (;;) {
    manifestJson = buildManifestJson(dataStart)
    const needed = 4 + pad4(Buffer.byteLength(manifestJson))
    if (needed <= dataStart) break
    dataStart = needed
  }
  const total =
    dataStart + DOTS * 8 + PEOPLE * 4 + HOUSEHOLDS * 4 + DIMS.length * PEOPLE
  const buffer = Buffer.alloc(total)
  buffer.writeUInt32LE(Buffer.byteLength(manifestJson), 0)
  buffer.write(manifestJson, 4, 'utf8')

  let offset = dataStart
  // Positions: a Collin-County-shaped cloud (~0.6 deg square around Plano).
  const positions = new Float32Array(buffer.buffer, offset, DOTS * 2)
  for (let i = 0; i < DOTS; i++) {
    positions[i * 2] = -96.9 + rnd() * 0.7
    positions[i * 2 + 1] = 32.95 + rnd() * 0.55
  }
  offset += DOTS * 8
  const personToHousehold = new Uint32Array(buffer.buffer, offset, PEOPLE)
  for (let i = 0; i < PEOPLE; i++) {
    personToHousehold[i] = Math.min(
      HOUSEHOLDS - 1,
      ((i / PEOPLE) * HOUSEHOLDS) | 0,
    )
  }
  offset += PEOPLE * 4
  const householdToDot = new Uint32Array(buffer.buffer, offset, HOUSEHOLDS)
  for (let i = 0; i < HOUSEHOLDS; i++) {
    householdToDot[i] = Math.min(DOTS - 1, ((i / HOUSEHOLDS) * DOTS) | 0)
  }
  offset += HOUSEHOLDS * 4
  for (const [, n] of DIMS) {
    const plane = new Uint8Array(buffer.buffer, offset, PEOPLE)
    for (let i = 0; i < PEOPLE; i++) plane[i] = (rnd() * n) | 0
    offset += PEOPLE
  }
  return buffer
}

// ---- verbatim from packDecoder.ts (minus the streaming envelope + zod) ----
const decodePack = (buffer) => {
  const packStart = 0
  const manifestBytes = new DataView(buffer).getUint32(packStart, true)
  const manifest = JSON.parse(
    new TextDecoder().decode(
      new Uint8Array(buffer, packStart + 4, manifestBytes),
    ),
  )
  const arrayByName = new Map(manifest.arrays.map((a) => [a.name, a]))
  const required = (name) => arrayByName.get(name)
  const positionsMeta = required('positions')
  const personMeta = required('personToHousehold')
  const householdMeta = required('householdToDot')
  const dimPlanes = new Map()
  for (const dim of manifest.dims) {
    const plane = required(`dim:${dim.key}`)
    dimPlanes.set(
      dim.key,
      new Uint8Array(buffer, packStart + plane.byteOffset, plane.elementCount),
    )
  }
  return {
    manifest,
    positions: new Float32Array(
      buffer,
      packStart + positionsMeta.byteOffset,
      positionsMeta.elementCount,
    ),
    personToHousehold: new Uint32Array(
      buffer,
      packStart + personMeta.byteOffset,
      personMeta.elementCount,
    ),
    householdToDot: new Uint32Array(
      buffer,
      packStart + householdMeta.byteOffset,
      householdMeta.elementCount,
    ),
    dimPlanes,
  }
}

// ---- verbatim from filterEngine.ts ----
const activeDimMasks = (pack, selections) => {
  const active = []
  for (const dim of pack.manifest.dims) {
    const selected = selections.get(dim.key)
    if (!selected || selected.size >= dim.values.length) continue
    const mask = new Uint8Array(dim.values.length)
    for (const value of selected) mask[value] = 1
    const plane = pack.dimPlanes.get(dim.key)
    if (plane) active.push({ plane, mask })
  }
  return active
}

const runFilter = (pack, selections) => {
  const { personToHousehold, householdToDot, dimPlanes, manifest } = pack
  const peopleCount = personToHousehold.length
  const dotCount = manifest.counts.dots
  const active = activeDimMasks(pack, selections)
  const canvassPlane = dimPlanes.get('canvassStatus')
  const matchedPerDot = new Uint32Array(dotCount)
  const statusPerDot = new Uint8Array(dotCount).fill(255)
  const householdSeen = new Uint8Array(manifest.counts.households)
  let people = 0
  let households = 0
  outer: for (let i = 0; i < peopleCount; i++) {
    for (let a = 0; a < active.length; a++) {
      const entry = active[a]
      if (entry && !entry.mask[entry.plane[i] ?? 0]) continue outer
    }
    people++
    const household = personToHousehold[i] ?? 0
    const dot = householdToDot[household] ?? 0
    matchedPerDot[dot] = (matchedPerDot[dot] ?? 0) + 1
    if (!householdSeen[household]) {
      householdSeen[household] = 1
      households++
    }
    const status = canvassPlane?.[i] ?? 0
    if (status < (statusPerDot[dot] ?? 255)) statusPerDot[dot] = status
  }
  return { people, households, matchedPerDot, statusPerDot }
}

const canvassStatusCounts = (pack, selections, ring) => {
  const { personToHousehold, dimPlanes, manifest } = pack
  const dim = manifest.dims.find((entry) => entry.key === 'canvassStatus')
  const plane = dimPlanes.get('canvassStatus')
  const counts = new Array(dim?.values.length ?? 0).fill(0)
  if (!dim || !plane) return counts
  const active = activeDimMasks(pack, selections)
  void ring
  outer: for (let i = 0; i < personToHousehold.length; i++) {
    for (let a = 0; a < active.length; a++) {
      const entry = active[a]
      if (entry && !entry.mask[entry.plane[i] ?? 0]) continue outer
    }
    const status = plane[i] ?? 0
    if (status < counts.length) counts[status] = (counts[status] ?? 0) + 1
  }
  return counts
}

// ---- verbatim from VoterMapCanvas.tsx ----
const STATUS_COLORS = Array.from({ length: 7 }, (_, i) => [
  i * 30,
  120,
  200,
  210,
])
const UNMATCHED_COLOR = [190, 195, 200, 60]
const buildColors = (filterResult, dotCount) => {
  const colors = new Uint8Array(dotCount * 4)
  for (let i = 0; i < dotCount; i++) {
    const matched = (filterResult.matchedPerDot[i] ?? 0) > 0
    const status = filterResult.statusPerDot[i] ?? 255
    const color = matched
      ? (STATUS_COLORS[status] ?? STATUS_COLORS[0])
      : UNMATCHED_COLOR
    const offset = i * 4
    colors[offset] = color?.[0] ?? 0
    colors[offset + 1] = color?.[1] ?? 0
    colors[offset + 2] = color?.[2] ?? 0
    colors[offset + 3] = color?.[3] ?? 0
  }
  return colors
}

const packOpeningCenter = (positions) => {
  const dots = positions.length >> 1
  if (dots === 0) return null
  const lngs = new Float32Array(dots)
  const lats = new Float32Array(dots)
  for (let i = 0; i < dots; i++) {
    lngs[i] = positions[i * 2] ?? 0
    lats[i] = positions[i * 2 + 1] ?? 0
  }
  lngs.sort()
  lats.sort()
  const mid = dots >> 1
  const anchorLng = lngs[mid] ?? 0
  const anchorLat = lats[mid] ?? 0
  const lngScale = Math.cos((anchorLat * Math.PI) / 180)
  let best = 0
  let bestDistance = Infinity
  for (let i = 0; i < dots; i++) {
    const dx = ((positions[i * 2] ?? 0) - anchorLng) * lngScale
    const dy = (positions[i * 2 + 1] ?? 0) - anchorLat
    const distance = dx * dx + dy * dy
    if (distance < bestDistance) {
      bestDistance = distance
      best = i
    }
  }
  return [positions[best * 2] ?? 0, positions[best * 2 + 1] ?? 0]
}

const bench = (label, fn, runs = 5) => {
  const times = []
  let out
  for (let i = 0; i < runs; i++) {
    const t = performance.now()
    out = fn()
    times.push(performance.now() - t)
  }
  times.sort((a, b) => a - b)
  console.log(
    `${label.padEnd(46)} best ${times[0].toFixed(1).padStart(8)} ms   median ${times[runs >> 1].toFixed(1).padStart(8)} ms`,
  )
  return out
}

const node = Buffer.alloc(0)
void node

console.log(`people=${PEOPLE} households=${HOUSEHOLDS} dots=${DOTS}`)
const buf = buildPackBuffer()
console.log(`pack bytes = ${buf.byteLength.toLocaleString()}`)
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)

const pack = bench(
  'decodePack (mount typed-array views)',
  () => decodePack(ab),
  20,
)

// A realistic landing-map selection: every dim fully selected except party,
// which is what the rail's default scope looks like once a list is chosen.
const selections = new Map()
selections.set('party', new Set([1, 2]))

bench('runFilter (1 active dim)', () => runFilter(pack, selections))
const noSelections = new Map()
const result = bench('runFilter (0 active dims)', () =>
  runFilter(pack, noSelections),
)
bench('canvassStatusCounts (district-wide)', () =>
  canvassStatusCounts(pack, selections, null),
)
bench('buildColors', () => buildColors(result, DOTS))
bench('packOpeningCenter', () => packOpeningCenter(pack.positions))

// Transport: what compression would do to the wire.
const zlib = await import('node:zlib')
const { promisify } = await import('node:util')
const gzip = promisify(zlib.gzip)
const brotli = promisify(zlib.brotliCompress)
for (const [label, fn] of [
  ['gzip level 1', () => gzip(buf, { level: 1 })],
  ['gzip level 6', () => gzip(buf, { level: 6 })],
  [
    'brotli quality 4',
    () =>
      brotli(buf, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.byteLength,
        },
      }),
  ],
]) {
  const t = performance.now()
  const out = await fn()
  const ms = performance.now() - t
  console.log(
    `${label.padEnd(46)} ${(out.byteLength / 1e6).toFixed(2)} MB  (${((out.byteLength / buf.byteLength) * 100).toFixed(1)}%)  in ${ms.toFixed(0)} ms`,
  )
}
