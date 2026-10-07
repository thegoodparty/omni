import { z } from 'zod'

// Packages the local-setup bootstrap can be handed a `.env` for. election-api
// is deliberately absent: it is never run locally, gp-webapp points at the
// deployed dev instance it already defaults to. `mcp` is not a package but
// the repo's MCP servers (.mcp.json), written to the root .env.mcp.local.
export const DEV_ENV_PACKAGE_VALUES = ['gp-api', 'gp-webapp', 'mcp'] as const
export type DevEnvPackage = (typeof DEV_ENV_PACKAGE_VALUES)[number]
export const DevEnvPackageSchema = z.enum(DEV_ENV_PACKAGE_VALUES)

// `variables` carries live dev credentials by contract — never log a bundle,
// a response object, or anything derived from `variables` (the test-fixtures
// responses carry the same warning).
export const DevEnvPackageBundleSchema = z.object({
  package: DevEnvPackageSchema,
  variables: z.record(z.string(), z.string()),
})
export type DevEnvPackageBundle = z.infer<typeof DevEnvPackageBundleSchema>

export const DevEnvBundleResponseSchema = z.object({
  bundles: z.array(DevEnvPackageBundleSchema),
})
export type DevEnvBundleResponse = z.infer<typeof DevEnvBundleResponseSchema>
