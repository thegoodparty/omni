import type { Profiler } from 'node:inspector'

const TOP_FRAMES = 15
const TOP_STACKS = 5
const STACK_DEPTH = 12

const frameLabel = (node: Profiler.ProfileNode) => {
  const { functionName, url, lineNumber } = node.callFrame
  const file = url.replace(/^file:\/\/\/app\//, '')
  return file
    ? `${functionName || '(anonymous)'} ${file}:${lineNumber + 1}`
    : functionName || '(anonymous)'
}

export const summarizeProfile = (
  profile: Profiler.Profile,
  sampleMs: number,
) => {
  const parentOf = new Map<number, Profiler.ProfileNode>()
  for (const node of profile.nodes) {
    for (const childId of node.children ?? []) parentOf.set(childId, node)
  }

  const selfMs = new Map<string, number>()
  const stackMs = new Map<string, number>()
  let busyMs = 0
  for (const node of profile.nodes) {
    const hits = node.hitCount ?? 0
    if (!hits || node.callFrame.functionName === '(idle)') continue
    const ms = hits * sampleMs
    busyMs += ms
    const label = frameLabel(node)
    selfMs.set(label, (selfMs.get(label) ?? 0) + ms)

    const frames: string[] = []
    let current: Profiler.ProfileNode | undefined = node
    while (current && frames.length < STACK_DEPTH) {
      if (current.callFrame.functionName !== '(root)') {
        frames.push(frameLabel(current))
      }
      current = parentOf.get(current.id)
    }
    const stack = frames.join(' < ')
    stackMs.set(stack, (stackMs.get(stack) ?? 0) + ms)
  }

  const top = (entries: Map<string, number>, count: number) =>
    [...entries.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, count)
      .map(([name, ms]) => ({ name, ms: Math.round(ms) }))

  return {
    busyMs: Math.round(busyMs),
    topSelf: top(selfMs, TOP_FRAMES),
    topStacks: top(stackMs, TOP_STACKS),
  }
}
