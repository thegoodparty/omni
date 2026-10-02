/**
 * Golden input cases — the fixed set of inputs every variant is run against.
 *
 * A case is an id, a label, and the params the agent takes. Cases are fixed on
 * purpose: a comparison only means something if both sides answered the same
 * questions, and a set that drifts between runs cannot be compared to last week's.
 *
 * Background agents also need an organization_slug. The runner injects a unique
 * one per run rather than reading it from the file, so two variants of the same
 * case never collide on the mutable `<experiment>/<slug>/latest.json` pointer, and
 * so no real production org slug has to be committed to this repo.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { Case } from './types.js'

const HERE = dirname(fileURLToPath(import.meta.url))
export const CASES_DIR = join(HERE, '..', 'cases')

const CaseFileSchema = z.object({
  agent: z.string(),
  description: z.string().optional(),
  cases: z
    .array(
      z.object({
        id: z
          .string()
          .regex(/^[a-z0-9_]+$/, 'case ids are lowercase, digits, underscore'),
        label: z.string().optional(),
        params: z.record(z.string(), z.unknown()),
      }),
    )
    .min(1),
})

export const loadCases = (
  agent: string,
  limit?: number,
  casesDir = CASES_DIR,
): Case[] => {
  const path = join(casesDir, `${agent}.json`)
  if (!existsSync(path)) {
    throw new Error(
      `no golden cases for "${agent}"; expected ${path}. Add a case file before evaluating this agent.`,
    )
  }

  const parsed = CaseFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
  const ids = new Set(parsed.cases.map((c) => c.id))
  if (ids.size !== parsed.cases.length) {
    throw new Error(`duplicate case ids in ${path}`)
  }

  const cases: Case[] = parsed.cases.map((c) => ({
    id: c.id,
    label: c.label ?? c.id,
    params: c.params,
  }))
  return limit ? cases.slice(0, limit) : cases
}

/**
 * A dispatchable organization_slug unique to (case, variant).
 *
 * Must satisfy ^[a-zA-Z0-9_-]{1,64}$ and must differ between variants so the two
 * sides of a comparison do not overwrite each other's latest.json.
 */
export const slugFor = (agent: string, caseId: string, variantTag: string) =>
  `uj-${variantTag}-${agent}-${caseId}`
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
