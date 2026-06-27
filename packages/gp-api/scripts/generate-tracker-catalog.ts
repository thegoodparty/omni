import { mkdirSync, writeFileSync } from 'node:fs'
import { CAMPAIGN_TASK_CATALOG } from '@goodparty_org/contracts'

// Generates the dynamic task menu the `campaign_tracker_tasks` experiment
// selects from, shipped as an experiment ATTACHMENT (the runner drops it at
// /workspace/task_catalog.json before the agent starts) instead of being
// passed in the dispatch params — the full catalog with descriptions exceeds
// the 6 KB SQS param-size limit. Source of truth is @goodparty_org/contracts;
// re-run this when the catalog changes:
//   npx tsx scripts/generate-tracker-catalog.ts

const menu = CAMPAIGN_TASK_CATALOG.filter(
  (task) => task.type === 'dynamic',
).map((task) => ({
  id: task.id,
  title: task.title,
  description: task.description,
  phase: task.phase,
  channel: task.channel,
}))

const dir = `${__dirname}/../../runbooks/experiments/campaign_tracker_tasks/attachments`
mkdirSync(dir, { recursive: true })
const outPath = `${dir}/task_catalog.json`
writeFileSync(outPath, `${JSON.stringify(menu, null, 2)}\n`)

console.log(`✅ wrote ${menu.length} dynamic tasks to ${outPath}`)
