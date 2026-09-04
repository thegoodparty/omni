import { BadGatewayException } from '@nestjs/common'

// A PERMANENT BigQuery failure: a request that will not succeed on retry —
// auth (401/403), notFound (404), or bad SQL / invalid request (400). Extends
// BadGatewayException so the HTTP status and generic message are UNCHANGED for
// every caller (a BigQuery failure is still a 502 vendor failure to the
// client). The distinct class only lets a caller that retries tell "stop
// retrying, this is permanent" from a transient blip (429 / 5xx / network),
// which stays a plain BadGatewayException.
export class BigqueryPermanentError extends BadGatewayException {}
