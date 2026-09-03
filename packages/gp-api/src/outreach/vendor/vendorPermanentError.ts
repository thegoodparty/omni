import { BadGatewayException } from '@nestjs/common'

// A PERMANENT robocall-vendor failure: a request that will not succeed on
// retry (a 4xx client/validation error), as opposed to a transient 5xx /
// network failure or a 429 throttle. Vendor-neutral — a CallHub or CallFire
// adapter both throw THIS when they classify a failure as permanent. Extends
// BadGatewayException so the HTTP status and generic message are unchanged for
// every caller (a vendor error is still a 502 to the client); the distinct
// class only lets the send/staging state machines tell "stop retrying, this is
// permanent" (fail + void + email) from "retry, this was transient". Mirrors
// the semantics of the CallHub-specific CallhubPermanentError it generalizes.
export class VendorPermanentError extends BadGatewayException {}
