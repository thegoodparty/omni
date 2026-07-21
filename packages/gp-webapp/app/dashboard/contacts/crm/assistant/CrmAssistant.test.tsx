import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import CrmAssistant from './CrmAssistant'
import { useContactsTable } from '../ContactsTableProvider'
import { campaignManagerChatApi } from '../../../campaign-manager/campaignManagerChat'
import { chiefOfStaffChatApi } from '../../../chief-of-staff/data/chat-api'
import type { AssistantChatBinding } from './assistantChat'
import type { AssistantRequest } from './AssistantDrawer'

vi.mock('../ContactsTableProvider', () => ({
  useContactsTable: vi.fn(),
}))

interface BarProps {
  chat: AssistantChatBinding
  onSubmit: (message: string) => void
}
let lastBarProps: BarProps | null = null
vi.mock('./AssistantBar', () => ({
  default: (props: BarProps) => {
    lastBarProps = props
    return (
      <button onClick={() => props.onSubmit('young supporters')}>
        submit assistant
      </button>
    )
  },
}))

interface DrawerProps {
  open: boolean
  request: AssistantRequest | null
  chat: AssistantChatBinding
  title: string
}
let lastDrawerProps: DrawerProps | null = null
vi.mock('./AssistantDrawer', () => ({
  default: (props: DrawerProps) => {
    lastDrawerProps = props
    return props.open ? <div data-testid="assistant-drawer" /> : null
  },
}))

const mockedUseContactsTable = vi.mocked(useContactsTable)

const setContext = (isWinContext: boolean, isWinContextReady = true) => {
  mockedUseContactsTable.mockReturnValue({
    isWinContext,
    isWinContextReady,
  } as ReturnType<typeof useContactsTable>)
}

beforeEach(() => {
  lastBarProps = null
  lastDrawerProps = null
})

describe('CrmAssistant', () => {
  it('renders nothing until the Win/Serve mode settles', () => {
    setContext(false, false)
    render(<CrmAssistant />)
    expect(screen.queryByText('submit assistant')).not.toBeInTheDocument()
  })

  it('binds Win to the campaign_assistant client and Voter copy', () => {
    setContext(true)
    render(<CrmAssistant />)
    expect(lastBarProps?.chat.chatApi).toBe(campaignManagerChatApi)
    expect(lastDrawerProps?.title).toBe('Voter list assistant')
  })

  it('binds Serve to the chief_of_staff client and Constituent copy', () => {
    setContext(false)
    render(<CrmAssistant />)
    expect(lastBarProps?.chat.chatApi).toBe(chiefOfStaffChatApi)
    expect(lastDrawerProps?.title).toBe('Constituent list assistant')
  })

  it('opens the drawer with the submitted message', async () => {
    const user = userEvent.setup()
    setContext(true)
    render(<CrmAssistant />)
    expect(lastDrawerProps?.open).toBe(false)
    await user.click(screen.getByText('submit assistant'))
    expect(screen.getByTestId('assistant-drawer')).toBeInTheDocument()
    expect(lastDrawerProps?.request).toEqual({
      kind: 'new',
      initialMessage: 'young supporters',
    })
  })
})
