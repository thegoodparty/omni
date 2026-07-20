import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import OrdinancesChatDock from './OrdinancesChatDock'

vi.mock('../../chief-of-staff/components/chat/FooterChatBar', () => ({
  default: ({
    onOpen,
    onOpenConversation,
  }: {
    onOpen: () => void
    onOpenConversation: (id: string) => void
  }) => (
    <div>
      <button onClick={onOpen}>open-new</button>
      <button onClick={() => onOpenConversation('conv-1')}>
        open-existing
      </button>
    </div>
  ),
}))

vi.mock('../../chief-of-staff/components/chat/ChiefOfStaffChatSurface', () => ({
  default: ({
    open,
    initialConversationId,
  }: {
    open: boolean
    initialConversationId?: string | null
  }) =>
    open ? (
      <div data-testid="cos-surface">{initialConversationId ?? 'new'}</div>
    ) : null,
}))

vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [{ firstName: 'Sam' }],
}))

describe('OrdinancesChatDock', () => {
  it('opens a fresh Chief of Staff chat from the footer bar', () => {
    render(<OrdinancesChatDock />)

    expect(screen.queryByTestId('cos-surface')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('open-new'))
    expect(screen.getByTestId('cos-surface')).toHaveTextContent('new')
  })

  it('opens a chosen past conversation from the footer bar', () => {
    render(<OrdinancesChatDock />)

    fireEvent.click(screen.getByText('open-existing'))
    expect(screen.getByTestId('cos-surface')).toHaveTextContent('conv-1')
  })
})
