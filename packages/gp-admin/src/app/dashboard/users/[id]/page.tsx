import { Metadata } from 'next'
import { UserSection } from './components/UserSection'
import { ViewLayout } from './components/ViewLayout'

export const metadata: Metadata = {
  title: 'User Details | GP Admin',
  description: 'View user details',
}

export default function Page() {
  return (
    <ViewLayout>
      <UserSection />
    </ViewLayout>
  )
}
