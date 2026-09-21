import { HttpAdapterHost } from '@nestjs/core'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { MAX_RESULTS_CSV_BYTES } from './outreachResultsCsv.util'

/**
 * Raise the request body limit for the ONE route that takes a results CSV.
 *
 * The upload carries the file as a raw string inside a JSON body (A8's
 * contract, so a poll's bytes can later reach S3 exactly as fulfilment
 * produced them). gp-api's FastifyAdapter is built with no `bodyLimit`, so
 * Fastify's 1 MiB default applies to every route — which made
 * `MAX_RESULTS_CSV_BYTES` unreachable: anything over ~1 MB was refused with a
 * generic 413 before the readable "that file is larger than 5MB" sentence
 * could ever be produced. A results file for a send with thousands of
 * recipients clears 1 MiB easily, so that was not a theoretical gap.
 *
 * Scoped to this route rather than raised globally on purpose. The adapter's
 * limit is the one thing standing between ~380 endpoints — several of them
 * public — and an arbitrarily large buffered body, and widening it for all of
 * them to fix one staff upload is a real change in exposure for no reason.
 * Fastify supports `bodyLimit` per route; Nest's decorators cannot pass route
 * options, but an `onRoute` hook can set them as the route is registered
 * (fastify/lib/route.js runs the hooks before it builds the route context,
 * which is what reads `bodyLimit`).
 *
 * The hook has to be installed BEFORE Nest registers its controllers, which
 * happens in `app.init()`. Module constructors run earlier, during
 * `NestFactory.create`, so that is where this is called from — see
 * `outreach.module.ts`. The cost of that ordering is that a route rename here
 * would silently stop matching, so the route test uploads an over-1 MiB body
 * and asserts it is not a 413: if this ever stops applying, CI says so.
 */

// The JSON envelope is always bigger than the CSV it carries: newlines and
// quotes are escaped to two characters each, and `fileName` / `sourceLabel` /
// `dryRun` ride along. 1 MiB of headroom over the documented CSV cap covers
// roughly 20% escaping overhead, which no real results file approaches.
//
// This is deliberately derived from MAX_RESULTS_CSV_BYTES rather than written
// out, because the defect being fixed here was exactly the two numbers
// disagreeing. The server's readable refusal fires first; the limit below only
// ever catches a body that is pathologically escaped.
const JSON_ENVELOPE_HEADROOM_BYTES = 1024 * 1024

export const RESULTS_UPLOAD_BODY_LIMIT_BYTES =
  MAX_RESULTS_CSV_BYTES + JSON_ENVELOPE_HEADROOM_BYTES

// As Nest registers it: the `v1` global prefix, then the controller path.
export const RESULTS_UPLOAD_ROUTE = '/v1/outreach/admin/results/:outreachId'

/**
 * Returns whether the hook was installed. False in a testing module that has
 * no HTTP adapter, which is every `Test.createTestingModule` suite that
 * imports OutreachModule — those have no routes to size, and throwing there
 * would take down every one of them.
 */
export function registerResultsUploadBodyLimit(
  httpAdapterHost: HttpAdapterHost,
): boolean {
  // HttpAdapterHost.httpAdapter is the abstract HttpAdapter; we know we run on
  // Fastify because @nestjs/platform-fastify is the only adapter wired in
  // src/app.ts, so narrowing here is safe. It is undefined before an adapter
  // is attached, which is the testing-module case above.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  const adapter = httpAdapterHost?.httpAdapter as FastifyAdapter | undefined
  if (typeof adapter?.getInstance !== 'function') return false

  adapter.getInstance().addHook('onRoute', (routeOptions) => {
    if (routeOptions.url !== RESULTS_UPLOAD_ROUTE) return
    const methods = Array.isArray(routeOptions.method)
      ? routeOptions.method
      : [routeOptions.method]
    if (!methods.includes('POST')) return
    routeOptions.bodyLimit = RESULTS_UPLOAD_BODY_LIMIT_BYTES
  })
  return true
}
