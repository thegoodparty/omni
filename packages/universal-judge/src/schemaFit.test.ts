import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadCases, slugFor } from './cases.js'
import { AGENTS } from './registry.js'

/**
 * Validates every golden input against the agent's real input_schema.
 *
 * This exists because a dispatch that violates the schema is rejected before any
 * container starts, and the only visible symptom is a run that never produces an
 * artifact — indistinguishable from a slow one until it times out. Every
 * meeting_briefing dispatch was silently rejected for injecting an
 * organization_slug the schema does not declare, and it cost two 50-minute
 * timeouts and $12 of nothing to find out.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const EXPERIMENTS = join(HERE, '..', '..', 'runbooks', 'experiments')

type Schema = {
  required?: string[]
  properties?: Record<string, unknown>
  additionalProperties?: boolean
}

const schemaFor = (experimentId: string): Schema =>
  JSON.parse(
    readFileSync(join(EXPERIMENTS, experimentId, 'manifest.json'), 'utf8'),
  ).input_schema ?? {}

const background = AGENTS.filter((a) => a.kind === 'background')

describe('golden inputs satisfy the agent input_schema', () => {
  it.each(background.map((a) => [a.name, a.experimentId!] as const))(
    '%s',
    (name, experimentId) => {
      const schema = schemaFor(experimentId)
      const declared = new Set(Object.keys(schema.properties ?? {}))

      for (const testCase of loadCases(name)) {
        // The runner adds organization_slug only when the schema declares it.
        const params: Record<string, unknown> = declared.has(
          'organization_slug',
        )
          ? {
              ...testCase.params,
              organization_slug: slugFor(name, testCase.id, 'main'),
            }
          : { ...testCase.params }

        for (const field of schema.required ?? []) {
          expect(
            params[field],
            `${name}/${testCase.id} is missing required "${field}"`,
          ).toBeDefined()
        }

        if (schema.additionalProperties === false) {
          for (const key of Object.keys(params)) {
            expect(
              declared.has(key),
              `${name}/${testCase.id} sends "${key}", which the schema does not declare`,
            ).toBe(true)
          }
        }
      }
    },
  )

  it('every registered background agent has a manifest on disk', () => {
    for (const agent of background) {
      expect(() => schemaFor(agent.experimentId!), agent.name).not.toThrow()
    }
  })

  it('knows which schemas take an organization_slug, so the runner can differ', () => {
    // Not cosmetic: getting this wrong in either direction breaks dispatch.
    expect(
      Object.keys(schemaFor('top_community_issues').properties ?? {}),
    ).toContain('organization_slug')
    expect(
      Object.keys(schemaFor('meeting_briefing').properties ?? {}),
    ).not.toContain('organization_slug')
  })
})
