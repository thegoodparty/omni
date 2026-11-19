// A fixed number of tasks in flight at once, results in the order they were
// handed in. One pool for the whole run: a case's six runs (three attempts on
// two arms) are six tasks, so a slow arm never leaves the other sitting idle.

export const runPool = async <T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  if (concurrency < 1 || !Number.isFinite(concurrency)) {
    throw new Error(`concurrency must be at least 1, got ${concurrency}`)
  }
  const results = new Array<R>(items.length)
  let next = 0

  const lane = async (): Promise<void> => {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await worker(items[index]!, index)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, lane),
  )
  return results
}
