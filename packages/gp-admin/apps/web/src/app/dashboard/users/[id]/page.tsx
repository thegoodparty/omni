import { Metadata } from 'next'
import { stubbedUser } from '@/data/stubbed-user'
import { UserSection } from './components/UserSection'
import { ViewLayout } from './components/ViewLayout'
import { getUser } from './actions'

export const metadata: Metadata = {
  title: 'User Details | GP Admin',
  description: 'View user details',
}

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function Page({ params }: PageProps) {
  const { id } = await params

  const result = await getUser(Number(id))
  console.log(`user =>`, result)

  return (
    <ViewLayout userId={id}>
      <UserSection user={stubbedUser} />
    </ViewLayout>
  )
}
