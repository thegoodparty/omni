import { Metadata } from 'next'
import DashboardPage from './components/DashboardPage'

export const metadata: Metadata = {
  title: 'Dashboard | GP Admin',
  description: 'Dashboard',
}

export default function page() {
  return <DashboardPage />
}
