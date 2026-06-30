/**
 * Flips an objects keys and values
 */
export function flip(
  obj: Record<PropertyKey, PropertyKey>,
): Record<PropertyKey, PropertyKey> {
  const ret: Record<PropertyKey, PropertyKey> = {}
  for (const [key, value] of Object.entries(obj)) {
    ret[value] = key
  }
  return ret
}
