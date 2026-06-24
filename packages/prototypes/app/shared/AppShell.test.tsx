import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LayoutDashboard, Send } from 'lucide-react'
import { AppShell, type ShellOrg } from './AppShell'

const orgs: ShellOrg[] = [
  {
    id: 'serve',
    name: 'Pittsboro Town Council',
    isPro: false,
    tabs: [
      {
        slug: 'overview',
        label: 'Overview',
        icon: LayoutDashboard,
        component: <div>Overview content</div>,
      },
      {
        slug: 'messages',
        label: 'Messages',
        icon: Send,
        component: <div>Messages content</div>,
      },
    ],
  },
]

describe('AppShell', () => {
  it('renders the active org name and a nav item per tab', () => {
    render(<AppShell userName="Renee Wells" orgs={orgs} />)
    expect(screen.getByText('Pittsboro Town Council')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Overview/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Messages/ })).toBeInTheDocument()
  })

  it('shows the first tab content by default', () => {
    render(<AppShell userName="Renee Wells" orgs={orgs} />)
    expect(screen.getByText('Overview content')).toBeInTheDocument()
    expect(screen.queryByText('Messages content')).not.toBeInTheDocument()
  })

  it('switches content when another tab is clicked', async () => {
    render(<AppShell userName="Renee Wells" orgs={orgs} />)
    await userEvent.click(screen.getByRole('button', { name: /Messages/ }))
    expect(screen.getByText('Messages content')).toBeInTheDocument()
    expect(screen.queryByText('Overview content')).not.toBeInTheDocument()
  })
})
