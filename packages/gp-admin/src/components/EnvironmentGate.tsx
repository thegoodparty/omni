import { auth } from '@clerk/nextjs/server'
import { ReactNode } from 'react'
import { AuthCallout } from './AuthCallout'
import {
  resolveEnvironment,
  servedEnvironments,
} from '@/shared/util/gpEnvironment'

export const environmentGateMessage = (): string =>
  `This deployment reaches the ${servedEnvironments().join(
    ' and '
  )} environment only. Pick the matching organization in the header to continue.`

// Clerk organizations are instance-wide, so the header switcher lists every
// organization a viewer belongs to whichever deployment they are on. This is
// what stops one of those choices from rendering a dashboard it cannot serve.
export const EnvironmentGate = async ({
  children,
}: {
  children: ReactNode
}) => {
  const { orgId } = await auth()

  if (!orgId) {
    return children
  }

  try {
    resolveEnvironment(orgId)
  } catch {
    return (
      <AuthCallout message={environmentGateMessage()} color="amber" centered />
    )
  }

  return children
}
