import { z } from 'zod'
import { GP_API_AUTH_MODE, type GpApiAuthMode } from '@/shared/gpApi'
import { generateUrl } from '@/shared/util/generateUrl.util'

export const GP_ENVIRONMENT = {
  DEV: 'dev',
  PROD: 'prod',
} as const

export type GpEnvironment = (typeof GP_ENVIRONMENT)[keyof typeof GP_ENVIRONMENT]

export type GpEnvironmentConfig = {
  gpApiRootUrl: string
  authMode: GpApiAuthMode
  m2mSecret?: string
}

const gpApiAuthModeSchema = z
  .enum([GP_API_AUTH_MODE.CLERK, GP_API_AUTH_MODE.OIDC])
  .default(GP_API_AUTH_MODE.CLERK)

const ORG_ID_ENV_KEYS: Record<GpEnvironment, string> = {
  [GP_ENVIRONMENT.DEV]: 'GP_ORG_ID_DEV',
  [GP_ENVIRONMENT.PROD]: 'GP_ORG_ID_PROD',
}

function isGpEnvironment(value: string): value is GpEnvironment {
  return Object.values(GP_ENVIRONMENT).includes(value as GpEnvironment)
}

export function resolveEnvironment(orgId: string): GpEnvironment {
  for (const [env, envKey] of Object.entries(ORG_ID_ENV_KEYS)) {
    if (process.env[envKey] === orgId && isGpEnvironment(env)) {
      return env
    }
  }
  throw new Error(`Unknown organization ID: ${orgId}`)
}

const ENV_CONFIG_KEYS: Record<
  GpEnvironment,
  { domain: string; secret: string }
> = {
  [GP_ENVIRONMENT.DEV]: {
    domain: 'GP_DEV_API_DOMAIN',
    secret: 'GP_DEV_MACHINE_SECRET',
  },
  [GP_ENVIRONMENT.PROD]: {
    domain: 'GP_PROD_API_DOMAIN',
    secret: 'GP_PROD_MACHINE_SECRET',
  },
}

export function getEnvironmentConfig(env: GpEnvironment): GpEnvironmentConfig {
  const { domain: domainKey, secret: secretKey } = ENV_CONFIG_KEYS[env]

  const domain = process.env[domainKey]
  const m2mSecret = process.env[secretKey] || undefined
  const protocol = process.env.GP_API_PROTOCOL
  const port = process.env.GP_API_PORT
  const rootPath = process.env.GP_API_ROOT_PATH

  if (!domain) {
    throw new Error(`${domainKey} is not set`)
  }
  const authModeResult = gpApiAuthModeSchema.safeParse(
    process.env.GP_API_AUTH_MODE || undefined
  )
  if (!authModeResult.success) {
    throw new Error(
      `GP_API_AUTH_MODE must be "${GP_API_AUTH_MODE.CLERK}" or "${GP_API_AUTH_MODE.OIDC}", got "${process.env.GP_API_AUTH_MODE}"`
    )
  }
  const authMode = authModeResult.data

  // In oidc mode the secret is only the fallback for when the Vercel OIDC
  // token can't be obtained, so GoodPartyClient.create decides if it's needed.
  if (!m2mSecret && authMode === GP_API_AUTH_MODE.CLERK) {
    throw new Error(`${secretKey} is not set`)
  }
  if (!protocol) {
    throw new Error('GP_API_PROTOCOL is not set')
  }

  const gpApiRootUrl = generateUrl({
    protocol,
    domain,
    port,
    rootPath,
  }).toString()

  return { gpApiRootUrl, authMode, m2mSecret }
}
