import { gpAction } from '@/shared/util/gpClient.util'
import { UserProvider } from './context/UserContext'
import { notFound } from 'next/navigation'

interface UserLayoutProps {
  children: React.ReactNode
  params: Promise<{ id: string }>
}

export default async function UserLayout({
  children,
  params,
}: UserLayoutProps) {
  const { id } = await params

  const result = await gpAction((client) => client.users.get(Number(id)))
  const user = result.success ? result.data : null
  if (!user) {
    notFound()
  }

  return <UserProvider user={user}>{children}</UserProvider>
}
