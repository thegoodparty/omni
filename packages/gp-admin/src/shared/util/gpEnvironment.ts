import { generateUrl } from '@/shared/util/generateUrl.util'

export const GP_ENVIRONMENT = {
  DEV: 'dev',
  PROD: 'prod',
} as const

export type GpEnvironment = (typeof GP_ENVIRONMENT)[keyof typeof GP_ENVIRONMENT]

export type GpEnvironmentConfig = {
  gpApiRootUrl: string
  m2mSecret: string
}

const ENVIRONMENTS_ENV_KEY = 'GP_ADMIN_ENVIRONMENTS'

const ORG_ID_ENV_KEYS: Record<GpEnvironment, string> = {
  [GP_ENVIRONMENT.DEV]: 'GP_ORG_ID_DEV',
  [GP_ENVIRONMENT.PROD]: 'GP_ORG_ID_PROD',
}

function isGpEnvironment(value: string): value is GpEnvironment {
  return Object.values(GP_ENVIRONMENT).includes(value as GpEnvironment)
}

const allEnvironments = (): readonly GpEnvironment[] =>
  Object.values(GP_ENVIRONMENT)

// The set of gp-api environments this deployment is allowed to reach. Declared
// rather than inferred from which secrets happen to be present, so adding an
// env var can never quietly widen a deployment's reach.
export const servedEnvironments = (): readonly GpEnvironment[] => {
  const raw = process.env[ENVIRONMENTS_ENV_KEY]?.trim()
  if (!raw) return allEnvironments()

  const names = raw
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)

  const unknown = names.filter((name) => !isGpEnvironment(name))
  if (unknown.length) {
    throw new Error(
      `${ENVIRONMENTS_ENV_KEY} names unknown environments: ${unknown.join(', ')}`
    )
  }

  const served = names.filter(isGpEnvironment)
  if (!served.length) {
    throw new Error(`${ENVIRONMENTS_ENV_KEY} names no environments`)
  }

  return served
}

export const isEnvironmentServed = (env: GpEnvironment): boolean =>
  servedEnvironments().includes(env)

const notServedError = (env: GpEnvironment): Error =>
  new Error(
    `This deployment does not serve the ${env} environment (${ENVIRONMENTS_ENV_KEY}=${servedEnvironments().join(
      ','
    )})`
  )

export function resolveEnvironment(orgId: string): GpEnvironment {
  for (const [env, envKey] of Object.entries(ORG_ID_ENV_KEYS)) {
    if (process.env[envKey] === orgId && isGpEnvironment(env)) {
      if (!isEnvironmentServed(env)) {
        throw notServedError(env)
      }
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
  // Checked again here, not only in resolveEnvironment, because this is the
  // one function that reads a machine secret out of the environment.
  if (!isEnvironmentServed(env)) {
    throw notServedError(env)
  }

  const { domain: domainKey, secret: secretKey } = ENV_CONFIG_KEYS[env]

  const domain = process.env[domainKey]
  const m2mSecret = process.env[secretKey]
  const protocol = process.env.GP_API_PROTOCOL
  const port = process.env.GP_API_PORT
  const rootPath = process.env.GP_API_ROOT_PATH

  if (!domain) {
    throw new Error(`${domainKey} is not set`)
  }
  if (!m2mSecret) {
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

  return { gpApiRootUrl, m2mSecret }
}
