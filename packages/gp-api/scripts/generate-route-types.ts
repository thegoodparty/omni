import { glob } from 'fast-glob'
import { readFileSync, writeFileSync } from 'fs'

export type Route = { method: string; path: string; endpoint: string }

// What an `@All()` handler actually answers on. Nest maps RequestMethod.ALL
// onto the adapter's `all()` (REQUEST_METHOD_MAP in
// @nestjs/core/helpers/router-method-factory.js), and fastify 5.8.5 fans `all()`
// out over its eight supported methods — `printRoutes()` on a bare instance
// carrying one `app.all('/mcp', ...)` reports
// `/mcp (GET, HEAD, TRACE, DELETE, OPTIONS, PATCH, PUT, POST)`.
//
// Written out rather than read from fastify because nothing exports it:
// `supportedMethods` is module-private and `require('fastify').supportedMethods`
// is undefined. A test asks a live fastify instance instead of trusting this
// list, so a version that adds a method fails there rather than quietly
// narrowing an alert to the methods this file still knows about.
export const ALL_METHODS = [
  'GET',
  'HEAD',
  'TRACE',
  'DELETE',
  'OPTIONS',
  'PATCH',
  'PUT',
  'POST',
] as const

// Keyed by decorator and valued by the methods it registers, because the two
// are not one-to-one — and a flat list of decorator names is precisely what hid
// `@All()`. src/mcp/mcp.controller.ts declares `@Controller('mcp')` with a
// single `@All()` handler, so the old list matched nothing in it, `mcp` was
// written into CONTROLLER_NAMES with an empty ROUTE_MAP, and `controllerAlerts`
// iterated nothing and returned no rule. In the 30 days to 2026-09-17 that
// endpoint served 69,016 GET and 24,736 POST requests in prod, 20 of which
// gp-api never answered, with no alert rule in existence to notice.
//
// The seven WebDAV decorators Nest also exports (@Propfind, @Mkcol, @Copy, ...)
// are deliberately absent: nothing in this estate speaks those methods, and the
// throw below now catches a controller that routes only through a decorator
// this map is missing, which is the failure mode that mattered.
const ROUTE_DECORATORS: Record<string, readonly string[]> = {
  Get: ['GET'],
  Post: ['POST'],
  Put: ['PUT'],
  Delete: ['DELETE'],
  Patch: ['PATCH'],
  Head: ['HEAD'],
  Options: ['OPTIONS'],
  Search: ['SEARCH'],
  All: ALL_METHODS,
}

/** The controller prefix and every route a single controller file declares. */
export const parseControllerFile = (
  relativePath: string,
  content: string,
): { controller: string; routes: Route[] } => {
  const controller = content.match(/@Controller\('([^']+)'\)/)?.[1]
  if (!controller) {
    const hasDecorator = content.match(/@Controller\(/)
    if (hasDecorator) {
      throw new Error(
        `${relativePath}: @Controller() must use a string literal (e.g. @Controller('my-route')). Variable references are not supported.`,
      )
    }

    throw new Error(
      `${relativePath}: Did not find a @Controller decorator in this file. Either add one, or rename the file to not match the .controller convention.`,
    )
  }

  const routes: Route[] = []
  for (const [decorator, methods] of Object.entries(ROUTE_DECORATORS)) {
    const regex = new RegExp(`@${decorator}\\((?:'([^']*)')?\\)`, 'g')
    let match: RegExpExecArray | null = null
    while ((match = regex.exec(content)) !== null) {
      const routePath = (match[1] ?? '').replace(/^\//, '').replace(/\/$/, '')
      for (const method of methods) {
        routes.push({
          method,
          path: routePath,
          endpoint: routePath
            ? `${method} /v1/${controller}/${routePath}`
            : `${method} /v1/${controller}`,
        })
      }
    }
  }

  // The gap that let `mcp` go unwatched, made unshippable. A controller with no
  // ROUTE_MAP entries still lands in CONTROLLER_NAMES, so it satisfies the
  // coverage tests in deploy/components/alerting/controller-alerts.test.ts by
  // being listed somewhere — while `controllerAlerts` generates no rule for it
  // and giving it an owner enables nothing. There is no alert to be wrong, and
  // therefore nothing anywhere to report the absence. Failing generation is the
  // only place that catches it before a deploy, and generation runs ahead of
  // lint, typecheck and test in CI (setup-node-workspace, route-types: true).
  if (routes.length === 0) {
    throw new Error(
      [
        `${relativePath}: @Controller('${controller}') declares no route handler this generator recognises, so it would be written into CONTROLLER_NAMES with an empty ROUTE_MAP.`,
        `controllerAlerts() iterates ROUTE_MAP, so a controller in that state generates NO Grafana rule: there is nothing for CONTROLLER_OWNERS to enable and nothing to say so.`,
        `That is how POST /v1/mcp took 24,736 requests in the 30 days to 2026-09-17, 19 of them answered by nothing at all, with no alert rule in existence.`,
        `Recognised decorators: ${Object.keys(ROUTE_DECORATORS).join(', ')}. If this controller routes through one that is missing, add it to ROUTE_DECORATORS in this file.`,
      ].join(' '),
    )
  }

  return { controller, routes }
}

/** Map of controller name to list of routes. */
export const buildRouteMap = (filePaths: string[]): Record<string, Route[]> => {
  const routeMap: Record<string, Route[]> = {}

  for (const filePath of filePaths) {
    const { controller, routes } = parseControllerFile(
      filePath.replace(`${__dirname}/../`, ''),
      readFileSync(filePath, 'utf8'),
    )

    // Multiple controller files may share a prefix (e.g. a feature module
    // mounting a route under 'campaigns') — merge instead of overwrite, or the
    // later file silently erases the earlier one's routes.
    routeMap[controller] = [...(routeMap[controller] ?? []), ...routes]
  }

  return routeMap
}

const main = () => {
  const routeMap = buildRouteMap(
    glob.sync(`${__dirname}/../src/**/*.controller.ts`),
  )

  const endpoints = Object.values(routeMap).flatMap((routes) =>
    routes.map((route) => route.endpoint),
  )

  writeFileSync(
    `${__dirname}/../src/generated/route-types.ts`,
    [
      `export const CONTROLLER_NAMES = ${JSON.stringify(Object.keys(routeMap), null, 2)} as const;`,
      '',
      'export type ControllerName = (typeof CONTROLLER_NAMES)[number];',
      '',
      `export const ROUTE_MAP: Record<ControllerName, { method: string; path: string; endpoint: string }[]> = ${JSON.stringify(routeMap, null, 2)} as const;`,
      '',
      `export const ENDPOINTS = ${JSON.stringify(endpoints, null, 2)} as const;`,
      '',
      'export type Endpoint = (typeof ENDPOINTS)[number];',
    ].join('\n'),
  )
}

// Only invoke main when run directly via tsx / node. Under vitest the file is
// imported for its exports and must not rewrite the generated module.
if (require.main === module) {
  main()
}
