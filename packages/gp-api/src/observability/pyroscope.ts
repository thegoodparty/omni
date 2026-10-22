import { hostname } from 'node:os'

const PROFILES_URL = 'https://profiles-prod-028.grafana.net'
const PROFILES_USER = '1532096'

// The Grafana Cloud access-policy token that signs the OTLP export also holds
// profiles:write, so the profiler reuses it rather than adding a secret.
export const tokenFromOtlpAuthorization = (
  authorization: string | undefined,
) => {
  const value = authorization ? decodeURIComponent(authorization) : ''
  if (!value.startsWith('Basic ')) return undefined
  const decoded = Buffer.from(value.slice('Basic '.length), 'base64').toString()
  const separator = decoded.indexOf(':')
  return separator === -1 ? undefined : decoded.slice(separator + 1)
}

export const startPyroscope = (authorization: string | undefined) => {
  if (process.env.PYROSCOPE_ENABLED !== 'true') return
  const token = tokenFromOtlpAuthorization(authorization)
  if (!token) {
    console.warn('Pyroscope disabled: no token in OTEL_EXPORTER_OTLP_HEADERS')
    return
  }
  // Loaded lazily so a native-module load failure costs the profiler, not
  // the process.
  import('@pyroscope/nodejs')
    .then(({ default: pyroscope }) => {
      pyroscope.init({
        appName: 'gp-api',
        serverAddress: PROFILES_URL,
        basicAuthUser: PROFILES_USER,
        basicAuthPassword: token,
        tags: {
          deployment_environment_name:
            process.env.OTEL_SERVICE_ENVIRONMENT ?? 'local',
          service_instance_id:
            process.env.OTEL_SERVICE_INSTANCE_ID || hostname(),
        },
        wall: { collectCpuTime: true },
      })
      pyroscope.start()
    })
    .catch((err: unknown) => console.warn('Pyroscope failed to start', err))
}
