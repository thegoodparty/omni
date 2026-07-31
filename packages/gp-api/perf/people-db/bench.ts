import { parseArgs as nodeParseArgs } from 'node:util'
import { createHarness } from './harness'
import { buildLatencyCases } from './cases'

export const parseArgs = (
  argv: string[],
): { mode: 'latency' | 'load'; env: string; smoke: boolean } => {
  const { values } = nodeParseArgs({
    args: argv,
    options: {
      mode: { type: 'string', default: 'latency' },
      env: { type: 'string', default: 'dev' },
      smoke: { type: 'boolean', default: false },
    },
  })
  const mode = values.mode === 'load' ? 'load' : 'latency'
  return { mode, env: String(values.env), smoke: Boolean(values.smoke) }
}

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2))
  const harness = await createHarness()
  try {
    if (args.smoke) {
      const [first] = buildLatencyCases()
      if (!first) throw new Error('no cases')
      const t = performance.now()
      await harness.invoke(first)
      console.log(`smoke ${first.id}: ${Math.round(performance.now() - t)}ms`)
      return
    }
    // latency / load runners wired in later tasks
    console.log(`mode=${args.mode} env=${args.env} (runner not wired yet)`)
  } finally {
    await harness.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
