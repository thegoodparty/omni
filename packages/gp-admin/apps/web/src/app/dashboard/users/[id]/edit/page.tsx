import { Metadata } from 'next'
import { ProtectedContent } from '@/components/ProtectedContent'
import { PERMISSIONS } from '@/lib/permissions'
import { stubbedUser } from '@/data/stubbed-user'
import UserEditPage from './components/UserEditPage'

export const metadata: Metadata = {
  title: 'Edit User | GP Admin',
  description: 'Edit user details',
}

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function Page({ params }: PageProps) {
  // TODO: Replace stubbed data with API call using params.id
  void params // Params will be used when API is connected

  return (
    <ProtectedContent requiredPermission={PERMISSIONS.WRITE_USERS}>
      <UserEditPage user={stubbedUser} />
    </ProtectedContent>
  )
}
