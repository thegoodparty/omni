export type DeploymentEnvironment = 'prod' | 'dev' | 'preview' | 'local'

// Vercel builds dev (main, aliased to dev.goodparty.org) and every PR preview
// on its `preview` target, so the target alone only says "not prod". The
// backend a build is baked against tells them apart: CI points each PR
// preview at its own pr-<n>.preview.goodparty.org gp-api stack.
//
// Same names as gp-api's `environment` alert label, so the prod-only alert
// routing in gp-api/deploy reads this value without a mapping.
export const deploymentEnvironment = ({
  vercelTargetEnv = process.env.NEXT_PUBLIC_VERCEL_TARGET_ENV,
  apiBase = process.env.NEXT_PUBLIC_API_BASE,
}: {
  vercelTargetEnv?: string
  apiBase?: string
} = {}): DeploymentEnvironment => {
  if (vercelTargetEnv === 'production') return 'prod'
  if (vercelTargetEnv !== 'preview') return 'local'
  return apiBase?.endsWith('.preview.goodparty.org') ? 'preview' : 'dev'
}
