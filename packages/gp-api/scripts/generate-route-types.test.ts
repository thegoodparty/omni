import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { ALL_METHODS, parseControllerFile } from './generate-route-types'

/** A controller file whose only handler is the decorator under test. */
const controllerFile = (decorator: string) =>
  `@Controller('mcp')
   export class McpController {
     ${decorator}
     async handle() {}
   }`

describe('parseControllerFile', () => {
  // The bug. `mcp`'s only handler is `@All()`, the generator looked for
  // `@Get`/`@Post`/`@Put`/`@Delete`/`@Patch` and nothing else, so the file
  // produced zero routes — and a controller with zero routes generates no
  // Grafana rule, which is why 19 no-answer requests on POST /v1/mcp in the 30
  // days to 2026-09-17 could not page anyone.
  it('expands an @All() handler into one route per method it answers', () => {
    const { routes } = parseControllerFile(
      'mcp.controller.ts',
      controllerFile('@All()'),
    )

    expect(routes.map(({ endpoint }) => endpoint)).toEqual(
      ALL_METHODS.map((method) => `${method} /v1/mcp`),
    )
  })

  // The generator's contract for every other decorator, which teaching it
  // `@All()` restructured the matching loop around. A regression there would
  // strip 384 of ROUTE_MAP's 392 routes and leave `mcp`'s eight standing, with
  // every assertion about `mcp` still green.
  it('still reads a single-method handler and its path', () => {
    const { controller, routes } = parseControllerFile(
      'mcp.controller.ts',
      controllerFile("@Post('tools/call')"),
    )

    expect(controller).toBe('mcp')
    expect(routes).toEqual([
      {
        method: 'POST',
        path: 'tools/call',
        endpoint: 'POST /v1/mcp/tools/call',
      },
    ])
  })

  // The fallback that makes this class of gap unshippable rather than merely
  // fixed. A controller routing through a decorator this generator does not
  // model lands in CONTROLLER_NAMES with an empty ROUTE_MAP, which satisfies
  // the coverage tests in deploy/components/alerting/controller-alerts.test.ts
  // while generating no rule and giving CONTROLLER_OWNERS nothing to enable —
  // the exact state `mcp` was in. There is no alert to be wrong, so nothing
  // downstream can report it; generation is the only place that can.
  it('refuses to emit a controller whose handlers it cannot see', () => {
    expect(() =>
      parseControllerFile('mcp.controller.ts', controllerFile('@Propfind()')),
    ).toThrow(/no route handler this generator recognises/)
  })
})

describe('ALL_METHODS', () => {
  // ALL_METHODS is a hardcoded copy of a list fastify keeps module-private
  // (`require('fastify').supportedMethods` is undefined), so nothing but this
  // stops it drifting. A fastify upgrade that adds a method to `all()` would
  // otherwise leave the mcp alert silently blind to it, which is a smaller
  // version of the bug this file's change exists to fix.
  it('matches the methods fastify registers for an all() route', async () => {
    const app = Fastify()
    app.all('/probe', (_request, reply) => reply.send())
    await app.ready()

    const printed = app.printRoutes({ commonPrefix: false })
    const registered = /\(([^)]+)\)/.exec(printed)?.[1]?.split(', ')
    await app.close()

    expect(registered).toBeDefined()
    expect(new Set(registered)).toEqual(new Set(ALL_METHODS))
  })
})
