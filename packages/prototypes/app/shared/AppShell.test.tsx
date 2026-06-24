import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LayoutDashboard, Send } from 'lucide-react'
import { AppShell, type ShellMode } from './AppShell'

const modes: ShellMode[] = [
  {
    id: 'serve',
    label: 'Serve',
    role: 'Serve – City Council',
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
  {
    id: 'win',
    label: 'Win',
    role: 'Win – 2026 Campaign',
    tabs: [
      {
        slug: 'campaign',
        label: 'Campaign',
        icon: LayoutDashboard,
        component: <div>Campaign content</div>,
      },
    ],
  },
]

describe('AppShell', () => {
  it('renders the active mode label and a nav item per tab', () => {
    render(<AppShell userName="Renee Wells" modes={modes} />)
    expect(screen.getByText('Serve')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Overview/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Messages/ })).toBeInTheDocument()
  })

  it('shows the first tab content by default', () => {
    render(<AppShell userName="Renee Wells" modes={modes} />)
    expect(screen.getByText('Overview content')).toBeInTheDocument()
    expect(screen.queryByText('Messages content')).not.toBeInTheDocument()
  })

  it('switches content when another tab is clicked', async () => {
    render(<AppShell userName="Renee Wells" modes={modes} />)
    await userEvent.click(screen.getByRole('button', { name: /Messages/ }))
    expect(screen.getByText('Messages content')).toBeInTheDocument()
    expect(screen.queryByText('Overview content')).not.toBeInTheDocument()
  })
})
