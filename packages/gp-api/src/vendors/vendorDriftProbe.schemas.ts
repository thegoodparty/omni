import { z } from 'zod'

// Shapes for the two probes whose real client returns a value already
// reduced from the raw body (a price, an SDK output) and so has no
// shared body schema to reuse. Every other probe parses with the schema the
// vendor mock builds its bodies from.

export const driftProbeVercelPriceSchema = z.object({
  price: z.number().nonnegative(),
})

// The Route53 Domains SDK output. The price list is the whole point of the
// call, so an empty one is drift too.
export const driftProbeRoute53PricesSchema = z.object({
  Prices: z.array(z.object({ Name: z.string() }).passthrough()).min(1),
})
