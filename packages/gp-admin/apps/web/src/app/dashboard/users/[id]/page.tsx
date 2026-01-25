import { Metadata } from 'next'
import UserDetailPage from './components/UserDetailPage'

export const metadata: Metadata = {
  title: 'User Details | GP Admin',
  description: 'View user details',
}

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function Page({ params }: PageProps) {
  const { id } = await params
  return <UserDetailPage userId={id} />
}
