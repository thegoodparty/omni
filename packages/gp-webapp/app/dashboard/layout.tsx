import { P2pUxEnabledProvider } from 'app/dashboard/components/tasks/flows/hooks/P2pUxEnabledProvider'

export default function DashboardSegmentLayout({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return <P2pUxEnabledProvider>{children}</P2pUxEnabledProvider>
}
