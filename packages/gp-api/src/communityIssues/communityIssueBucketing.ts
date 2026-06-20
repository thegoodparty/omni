// FNV-1a 32-bit hash — deterministic, no Math.random.
const fnv1a32 = (str: string): number => {
  let hash = 2166136261
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    // Multiply by FNV prime (16777619) via bitwise, keep 32-bit unsigned
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * Maps an org slug to a stable bucket in [0, mod). Deterministic: the same
 * slug always returns the same bucket, with no randomness.
 *
 * Used by crons to spread dispatches across days:
 *   trending — bucketForSlug(slug, 7) === today.getUTCDay()
 *   top      — bucketForSlug(slug, 28) === Math.min(today.getUTCDate(), 28) - 1
 */
export const bucketForSlug = (slug: string, mod: number): number =>
  fnv1a32(slug) % mod
