import { Metadata } from 'next'
import { stubbedUser } from '@/data/stubbed-user'
import { UserSection } from './components/UserSection'
import { ViewLayout } from './components/ViewLayout'

export const metadata: Metadata = {
  title: 'User Details | GP Admin',
  description: 'View user details',
}

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function Page({ params }: PageProps) {
  const { id } = await params
  // TODO: Replace stubbed data with API call using id
  void id

  return (
    <ViewLayout userId={id}>
      <UserSection user={stubbedUser} />
    </ViewLayout>
  )
}
