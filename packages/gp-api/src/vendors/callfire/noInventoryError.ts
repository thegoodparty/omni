import { BadGatewayException } from '@nestjs/common'

// Thrown by CallfireNumbersService when a local-number search returns no
// candidates. Distinct from a transient BadGatewayException so the vendor
// adapter can trigger the national fallback without swallowing real errors.
export class NoInventoryError extends BadGatewayException {}
