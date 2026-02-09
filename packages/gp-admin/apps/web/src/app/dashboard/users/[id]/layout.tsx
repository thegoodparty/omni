import { gpAction } from '@/shared/util/gpClient.util'
import { UserProvider } from './context/UserContext'
import { notFound } from 'next/navigation'
import { SdkError } from '@goodparty_org/sdk'

interface UserLayoutProps {
  children: React.ReactNode
  params: Promise<{ id: string }>
}

export default async function UserLayout({
  children,
  params,
}: UserLayoutProps) {
  const { id } = await params

  let user
  try {
    user = await gpAction((client) => client.users.get(Number(id)))
  } catch (error) {
    if (error instanceof SdkError && error.status === 404) {
      notFound()
    }
    throw error
  }

  return <UserProvider user={user}>{children}</UserProvider>
}
