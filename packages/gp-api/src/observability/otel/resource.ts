import { hostname } from 'node:os'
import {
  ATTR_SERVICE_INSTANCE_ID,
  ATTR_SERVICE_NAME,
} from '@opentelemetry/semantic-conventions'
import { ATTR_DEPLOYMENT_ENVIRONMENT_NAME } from '@opentelemetry/semantic-conventions/incubating'

// Lives here rather than in otel.ts because that module starts the SDK as an
// import side effect — it is preloaded with `node -r`. Importing it from a
// test would patch http/prisma/nest and export to Grafana from the test
// process, so the two resources could never be asserted. This module is pure.
export const otelResourceAttributes = ({
  includeInstanceId,
}: {
  includeInstanceId: boolean
}): Record<string, string> => ({
  [ATTR_SERVICE_NAME]: 'gp-api',
  [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]:
    process.env.OTEL_SERVICE_ENVIRONMENT || 'local',
  ...(includeInstanceId
    ? {
        [ATTR_SERVICE_INSTANCE_ID]:
          process.env.OTEL_SERVICE_INSTANCE_ID || hostname(),
      }
    : {}),
})
