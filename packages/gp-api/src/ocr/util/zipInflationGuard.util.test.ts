import { describe, expect, it } from 'vitest'
import { declaredZipUncompressedSize } from './zipInflationGuard.util'

// Builds a buffer with just the central directory + EOCD — that is all
// declaredZipUncompressedSize reads (it never touches local headers / data).
const buildZip = (
  entries: { name: string; uncompressedSize: number }[],
): Buffer => {
  const cd = Buffer.concat(
    entries.map((e) => {
      const name = Buffer.from(e.name, 'utf8')
      const header = Buffer.alloc(46)
      header.writeUInt32LE(0x02014b50, 0) // central file header signature
      header.writeUInt32LE(e.uncompressedSize >>> 0, 24) // uncompressed size
      header.writeUInt16LE(name.length, 28) // file name length
      return Buffer.concat([header, name])
    }),
  )
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0) // EOCD signature
  eocd.writeUInt16LE(entries.length, 10) // total central directory records
  eocd.writeUInt32LE(cd.length, 12) // central directory size
  eocd.writeUInt32LE(0, 16) // central directory offset (cd is at buffer start)
  return Buffer.concat([cd, eocd])
}

describe('declaredZipUncompressedSize', () => {
  it('sums the declared uncompressed sizes from the central directory', () => {
    const buf = buildZip([
      { name: 'word/document.xml', uncompressedSize: 1000 },
      { name: '[Content_Types].xml', uncompressedSize: 234 },
    ])
    expect(declaredZipUncompressedSize(buf)).toBe(1234)
  })

  it('reports a bomb that declares gigabytes of inflated content', () => {
    const buf = buildZip([
      { name: 'word/document.xml', uncompressedSize: 2_000_000_000 },
    ])
    expect(declaredZipUncompressedSize(buf)).toBe(2_000_000_000)
  })

  it('treats a ZIP64 size sentinel as over-cap (Infinity)', () => {
    const buf = buildZip([
      { name: 'word/document.xml', uncompressedSize: 0xffffffff },
    ])
    expect(declaredZipUncompressedSize(buf)).toBe(Infinity)
  })

  it('returns null for a non-ZIP buffer', () => {
    expect(declaredZipUncompressedSize(Buffer.from('not a zip at all'))).toBe(
      null,
    )
  })
})
