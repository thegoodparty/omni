import {
  DoorKnockingPackManifest,
  DoorKnockingPackManifestSchema,
  PACK_STREAM_ALIGNMENT,
  PACK_STREAM_FRAME_HEADER_BYTES,
  PACK_STREAM_FRAME_KINDS,
  PACK_STREAM_MAGIC,
  PACK_STREAM_MAGIC_BYTES,
} from '@goodparty_org/contracts'

// A door logged on this device since the pack was built. It rides beside the
// binary rather than inside it because there is no row in the binary to patch:
// `buildPackSql` ships no person id — the client walks the arrays positionally
// — so a knock, which gp-api joins in by person id at build time, has nothing
// on this side to join to. The coordinate is the one handle both ends share:
// `positions` and a route stop's lat/lng are the same people_db columns cast
// the same way, so a stop lands on a dot exactly or on nothing.
export interface LoggedKnock {
  lng: number
  lat: number
  // Index into DOOR_KNOCK_STATUSES, which is the encoding the pack's own
  // `canvassStatus` plane already uses.
  status: number
}

export interface DecodedPack {
  manifest: DoorKnockingPackManifest
  // Interleaved [lng, lat] pairs, one per unique coordinate (dot).
  positions: Float32Array
  personToHousehold: Uint32Array
  householdToDot: Uint32Array
  // One u8 plane per manifest dim, keyed by dim key.
  dimPlanes: Map<string, Uint8Array>
  // Doors logged since this pack was built, folded in by `recordLoggedKnocks`
  // and applied by `applyLoggedKnocks`. Never set by the decoder: a pack that
  // has just arrived already carries these statuses in its `canvassStatus`
  // plane.
  loggedKnocks?: readonly LoggedKnock[]
}

// Thrown when the response never carried a pack — a build that died after the
// server had already committed a 200. It is a distinct type because it is the
// one pack failure the status code cannot express, and the map has to show it
// as an error rather than as an empty district.
export class PackStreamError extends Error {}

const padded = (byteLength: number): number =>
  Math.ceil(byteLength / PACK_STREAM_ALIGNMENT) * PACK_STREAM_ALIGNMENT

// Walks the streaming envelope (see DoorKnockingPack.schema.ts) and returns
// the byte offset the pack itself starts at, skipping the heartbeat frames
// that kept the connection alive while the server was building it. A response
// with no envelope magic is a pre-envelope gp-api, whose body IS the pack.
const findPackStart = (buffer: ArrayBuffer): number => {
  const bytes = new Uint8Array(buffer)
  const magic = new TextDecoder().decode(
    bytes.subarray(0, PACK_STREAM_MAGIC_BYTES),
  )
  if (magic !== PACK_STREAM_MAGIC) return 0

  const view = new DataView(buffer)
  let offset = PACK_STREAM_MAGIC_BYTES
  while (offset + PACK_STREAM_FRAME_HEADER_BYTES <= buffer.byteLength) {
    const kind = view.getUint32(offset, true)
    const payloadBytes = view.getUint32(offset + 4, true)
    const payloadStart = offset + PACK_STREAM_FRAME_HEADER_BYTES
    if (kind === PACK_STREAM_FRAME_KINDS.pack) return payloadStart
    if (kind === PACK_STREAM_FRAME_KINDS.error) {
      throw new PackStreamError(
        new TextDecoder().decode(
          new Uint8Array(buffer, payloadStart, payloadBytes),
        ),
      )
    }
    offset = payloadStart + padded(payloadBytes)
  }
  throw new PackStreamError(
    'the voter map download ended before the map data arrived',
  )
}

// Wire framing (see DoorKnockingPack.schema.ts): [u32 LE manifest length]
// [manifest JSON padded to 4 bytes][typed arrays at manifest byteOffsets],
// all relative to where the pack starts inside the streaming envelope. The
// f32/u32 offsets are 4-byte aligned by construction and the envelope keeps
// the pack itself 8-byte aligned, so views still mount without copying.
export const decodePack = (buffer: ArrayBuffer): DecodedPack => {
  const packStart = findPackStart(buffer)
  const manifestBytes = new DataView(buffer).getUint32(packStart, true)
  const manifest = DoorKnockingPackManifestSchema.parse(
    JSON.parse(
      new TextDecoder().decode(
        new Uint8Array(buffer, packStart + 4, manifestBytes),
      ),
    ),
  )

  const arrayByName = new Map(manifest.arrays.map((a) => [a.name, a]))
  const required = (name: string) => {
    const array = arrayByName.get(name)
    if (!array) throw new Error(`pack is missing the "${name}" array`)
    return array
  }

  const positionsMeta = required('positions')
  const personMeta = required('personToHousehold')
  const householdMeta = required('householdToDot')

  const dimPlanes = new Map<string, Uint8Array>()
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
