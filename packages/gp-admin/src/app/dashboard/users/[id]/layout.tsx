import { auth } from '@clerk/nextjs/server'
import { gpAction } from '@/shared/util/gpClient.util'
import { UserProvider } from './context/UserContext'
import { notFound } from 'next/navigation'
import { SdkError } from '@goodparty_org/sdk'
import { status } from '@poppanator/http-constants'
import { PERMISSIONS } from '@/lib/permissions'

interface UserLayoutProps {
  children: React.ReactNode
  params: Promise<{ id: string }>
}

export default async function UserLayout({
  children,
  params,
}: UserLayoutProps) {
  // gp-api's UserOwnerOrAdminGuard auto-passes any m2mToken-bearing request, so
  // per-staff authz is the admin app's responsibility — enforce READ_USERS here
  // before fetching, mirroring the gated agent-runs layout. Without this, an
  // under-privileged staff member could enumerate /dashboard/users/<id> and
  // server-render any user's PII.
  const { has } = await auth()
  if (!has?.({ permission: PERMISSIONS.READ_USERS })) {
    notFound()
  }

  const { id } = await params

  let user
  try {
    user = await gpAction((client) => client.users.get(Number(id)))
  } catch (error) {
    if (error instanceof SdkError && error.status === status.NotFound) {
      notFound()
    }
    throw error
  }

  return <UserProvider user={user}>{children}</UserProvider>
}
