// Both bundlers name a failed chunk fetch `ChunkLoadError`, but word the
// message differently: webpack says `Loading chunk <id> failed`, Turbopack
// (the Next 16 builder) says `Failed to load chunk <path> from module <id>`.
// The boundaries reload on this to pick up the current build, so matching one
// builder's wording silently turns recovery off when the other is deployed.
const CHUNK_LOAD_MESSAGE_PREFIXES = [
  'Loading chunk', // webpack
  'Failed to load chunk', // Turbopack
]

export const isChunkLoadError = (error?: Error | null): boolean =>
  error?.name === 'ChunkLoadError' ||
  CHUNK_LOAD_MESSAGE_PREFIXES.some((prefix) =>
    error?.message?.startsWith(prefix),
  )
