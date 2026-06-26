// A DOCX is a ZIP container that mammoth inflates entirely in memory. A small
// (<= ATTACHMENT_MAX_BYTES) but highly compressed DOCX can declare gigabytes of
// uncompressed content (DEFLATE amplification can exceed 1000:1), OOM-crashing
// the shared API process (CWE-409). The ZIP central directory records every
// entry's uncompressed size in plaintext, so the total declared inflation can
// be bounded WITHOUT decompressing anything — and a bomb rejected up front.

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_FILE_HEADER_SIGNATURE = 0x02014b50
const EOCD_MIN_SIZE = 22
const CENTRAL_FILE_HEADER_SIZE = 46
const MAX_ZIP_COMMENT = 0xffff
// A 0xFFFFFFFF size means the real value lives in a ZIP64 extra field. A
// legitimate sub-20MB DOCX never needs ZIP64, so treat the sentinel as over-cap
// (conservative reject) rather than parsing ZIP64.
const ZIP64_SENTINEL = 0xffffffff

/**
 * Total of every ZIP entry's declared uncompressed size, read from the central
 * directory (no decompression). Returns `Infinity` on a ZIP64 sentinel (safe
 * conservative reject), or `null` if the buffer is not a parseable ZIP — the
 * caller decides how to treat that (the DOCX extractor fails closed: an
 * unparseable CD is rejected, never passed to the inflating parser).
 */
export const declaredZipUncompressedSize = (buf: Buffer): number | null => {
  // The End Of Central Directory record sits at the end, optionally followed by
  // a comment up to 0xFFFF bytes — scan backwards for its signature.
  const minEocd = Math.max(0, buf.length - EOCD_MIN_SIZE - MAX_ZIP_COMMENT)
  let eocd = -1
  for (let i = buf.length - EOCD_MIN_SIZE; i >= minEocd; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return null

  const entryCount = buf.readUInt16LE(eocd + 10)
  let offset = buf.readUInt32LE(eocd + 16)
  if (offset === ZIP64_SENTINEL) return Infinity

  let total = 0
  for (let n = 0; n < entryCount; n++) {
    if (
      offset + CENTRAL_FILE_HEADER_SIZE > buf.length ||
      buf.readUInt32LE(offset) !== CENTRAL_FILE_HEADER_SIGNATURE
    ) {
      return null
    }
    const uncompressed = buf.readUInt32LE(offset + 24)
    if (uncompressed === ZIP64_SENTINEL) return Infinity
    total += uncompressed
    const nameLen = buf.readUInt16LE(offset + 28)
    const extraLen = buf.readUInt16LE(offset + 30)
    const commentLen = buf.readUInt16LE(offset + 32)
    offset += CENTRAL_FILE_HEADER_SIZE + nameLen + extraLen + commentLen
  }
  return total
}
