import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'

// The credential half of a BigQuery client's options. `projectId` is OUR GCP
// project (the one billed for the query jobs and where the service account
// holds BigQuery Job User); the dataset we read lives in CallHub's project and
// is reached by fully-qualifying it in SQL, so it is not part of these options.
export interface BigqueryCredentialOptions {
  keyFilename?: string
  credentials?: { client_email: string; private_key: string }
}

export interface BigqueryClientOptions extends BigqueryCredentialOptions {
  projectId: string
}

// Only the two fields BigQuery's `credentials` option consumes. Zod strips the
// rest of the service-account key (private_key_id, token_uri, ...) so nothing
// beyond what the client needs is carried around.
const ServiceAccountKeySchema = z.object({
  client_email: z.string().min(1),
  private_key: z.string().min(1),
})

// Asserted at use, never at import: an import-time throw would take down every
// gp-api boot in environments that never set these (this module ships inert,
// before CallHub has granted the service account access). Missing config must
// break only the BigQuery read path, never app startup. Read straight from
// process.env inside the function (not a module-load destructure) so the value
// is genuinely lazy and a caller/test that sets it later is honoured.
export const readBigqueryProjectId = (): string => {
  const projectId = process.env.CALLHUB_BQ_PROJECT_ID
  if (!projectId) {
    throw new Error('Missing CALLHUB_BQ_PROJECT_ID config')
  }
  return projectId
}

export const readBigqueryDataset = (): string => {
  const dataset = process.env.CALLHUB_BQ_DATASET
  if (!dataset) {
    throw new Error('Missing CALLHUB_BQ_DATASET config')
  }
  return dataset
}

// Two ways in, ADC preferred: GOOGLE_APPLICATION_CREDENTIALS (the standard ADC
// env — a path to the key JSON, and what a mounted-secret / workload-identity
// setup uses) wins when present; the inline CALLHUB_BQ_SA_KEY_JSON (the key
// JSON as a string, for our single secrets blob) is the fallback. With neither
// set we hand back nothing and let the BigQuery client resolve ambient ADC (a
// metadata server), which is still read-only. All paths are READ-ONLY: the
// service account needs only BigQuery Job User in OUR project and BigQuery Data
// Viewer on CallHub's dataset (granted by CallHub), never any write role.
export const readBigqueryCredentials = (): BigqueryCredentialOptions => {
  const keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS
  if (keyFilename) {
    return { keyFilename }
  }
  const inline = process.env.CALLHUB_BQ_SA_KEY_JSON
  if (inline) {
    return { credentials: ServiceAccountKeySchema.parse(JSON.parse(inline)) }
  }
  return {}
}

export const readBigqueryClientOptions = (): BigqueryClientOptions => ({
  projectId: readBigqueryProjectId(),
  ...readBigqueryCredentials(),
})

// Nest-facing wrapper so the client service can inject config the way the rest
// of the vendor modules do (mirrors CallhubBaseConfig). The reads delegate to
// the pure functions above, which the standalone probe script reuses directly.
export class CallhubBigqueryConfig {
  constructor(protected readonly logger: PinoLogger) {
    this.logger.setContext(this.constructor.name)
  }

  get projectId(): string {
    return readBigqueryProjectId()
  }

  get dataset(): string {
    return readBigqueryDataset()
  }

  clientOptions(): BigqueryClientOptions {
    return readBigqueryClientOptions()
  }
}
