import {
  DoorKnockingPackManifest,
  DoorKnockingPackManifestSchema,
} from '@goodparty_org/contracts'

export interface DecodedPack {
  manifest: DoorKnockingPackManifest
  // Interleaved [lng, lat] pairs, one per unique coordinate (dot).
  positions: Float32Array
  personToHousehold: Uint32Array
  householdToDot: Uint32Array
  // One u8 plane per manifest dim, keyed by dim key.
  dimPlanes: Map<string, Uint8Array>
}

// Wire framing (see DoorKnockingPack.schema.ts): [u32 LE manifest length]
// [manifest JSON padded to 4 bytes][typed arrays at manifest byteOffsets].
// The f32/u32 offsets are 4-byte aligned by construction, so views mount
// directly on the buffer without copying.
export const decodePack = (buffer: ArrayBuffer): DecodedPack => {
  const manifestBytes = new DataView(buffer).getUint32(0, true)
  const manifest = DoorKnockingPackManifestSchema.parse(
    JSON.parse(
      new TextDecoder().decode(new Uint8Array(buffer, 4, manifestBytes)),
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
      new Uint8Array(buffer, plane.byteOffset, plane.elementCount),
    )
  }

  return {
    manifest,
    positions: new Float32Array(
      buffer,
      positionsMeta.byteOffset,
      positionsMeta.elementCount,
    ),
    personToHousehold: new Uint32Array(
      buffer,
      personMeta.byteOffset,
      personMeta.elementCount,
    ),
    householdToDot: new Uint32Array(
      buffer,
      householdMeta.byteOffset,
      householdMeta.elementCount,
    ),
    dimPlanes,
  }
}
