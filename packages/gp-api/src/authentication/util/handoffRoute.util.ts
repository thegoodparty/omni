import { ExecutionContext } from '@nestjs/common'
import { PATH_METADATA } from '@nestjs/common/constants'

export const HANDOFF_ROUTE_PREFIX = 'outreach/agent/handoffs'

const trimSlashes = (path: string): string => path.replace(/^\/+|\/+$/g, '')

// The tier boundary is the controller's path, which a handler cannot widen.
export const isHandoffRoute = (context: ExecutionContext): boolean => {
  const metadata: unknown = Reflect.getMetadata(
    PATH_METADATA,
    context.getClass(),
  )
  const paths = Array.isArray(metadata) ? metadata : [metadata]
  return (
    paths.length > 0 &&
    paths.every((path) => {
      if (typeof path !== 'string') return false
      const trimmed = trimSlashes(path)
      return (
        trimmed === HANDOFF_ROUTE_PREFIX ||
        trimmed.startsWith(`${HANDOFF_ROUTE_PREFIX}/`)
      )
    })
  )
}
