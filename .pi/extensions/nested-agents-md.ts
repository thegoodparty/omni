import { readFile, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { isReadToolResult } from '@earendil-works/pi-coding-agent'

// pi loads AGENTS.md only from cwd and its parents at launch. This appends any
// AGENTS.md between cwd and a read file's directory to that read's result,
// once per directory per session. See AGENTS.md § Progressive disclosure.

const MAX_BYTES = 100 * 1024

export default (pi: ExtensionAPI) => {
  const injected = new Set<string>()

  pi.on('session_start', async () => injected.clear())
  pi.on('session_compact', async () => injected.clear())
  pi.on('session_tree', async () => injected.clear())

  pi.on('tool_result', async (event, ctx) => {
    if (!isReadToolResult(event) || event.isError) return undefined
    const path = event.input['path']
    if (typeof path !== 'string' || !path) return undefined
    if (!event.content.some((block) => block.type === 'text')) return undefined

    let root: string
    let file: string
    try {
      root = await realpath(ctx.cwd)
      const expanded = path.replace(/^@/, '').replace(/^~(?=$|\/)/, homedir())
      file = await realpath(resolve(ctx.cwd, expanded))
    } catch {
      return undefined
    }
    const rel = relative(root, dirname(file))
    if (rel.startsWith('..') || rel === '') return undefined

    const dirs: string[] = []
    let dir = root
    for (const part of rel.split(sep)) {
      dir = join(dir, part)
      dirs.push(dir)
    }

    let text = ''
    for (const d of dirs) {
      if (injected.has(d)) continue
      injected.add(d)
      const agentsPath = join(d, 'AGENTS.md')
      if (agentsPath === file) continue
      let content: string
      try {
        content = await readFile(agentsPath, 'utf-8')
      } catch {
        continue
      }
      if (Buffer.byteLength(content) > MAX_BYTES) {
        content = `${Buffer.from(content).subarray(0, MAX_BYTES).toString('utf-8')}\n[truncated]`
      }
      text += `\n\n<directory_context path="${relative(root, agentsPath)}">\n${content}\n</directory_context>`
    }

    if (!text) return undefined
    return { content: [...event.content, { type: 'text' as const, text }] }
  })
}
