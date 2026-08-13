/**
 * Returns the first element of an array, throwing if the array is empty.
 *
 * Intended for tests under `noUncheckedIndexedAccess`, where indexing an array
 * yields `T | undefined`. Asserting the element exists keeps the test's intent
 * (it expects a value to be present) while satisfying the compiler without
 * non-null assertions.
 */
export function firstOrThrow<T>(
  items: readonly T[],
  message = 'expected at least one element',
): T {
  const [first] = items
  if (first === undefined) throw new Error(message)
  return first
}

/**
 * Returns the element at `index`, throwing if it is absent. Companion to
 * {@link firstOrThrow} for non-zero indices (e.g. the second mock call).
 */
export function nthOrThrow<T>(
  items: readonly T[],
  index: number,
  message = `expected an element at index ${index}`,
): T {
  const item = items[index]
  if (item === undefined) throw new Error(message)
  return item
}
