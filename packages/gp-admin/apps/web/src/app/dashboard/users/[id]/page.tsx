import { Metadata } from 'next'
import UserDetailPage from './components/UserDetailPage'
import { stubbedUser } from '@/data/stubbed-user'

export const metadata: Metadata = {
  title: 'User Details | GP Admin',
  description: 'View user details',
}

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function Page({ params }: PageProps) {
  // TODO: Replace stubbed data with API call using params.id
  void params // Params will be used when API is connected
  return <UserDetailPage user={stubbedUser} />
}
