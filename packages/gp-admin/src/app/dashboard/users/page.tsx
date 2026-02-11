import { Metadata } from 'next'
import UsersPage from './components/UsersPage'

export const metadata: Metadata = {
  title: 'Users | GP Admin',
  description: 'Search and manage users',
}

export default function Page() {
  return <UsersPage />
}
