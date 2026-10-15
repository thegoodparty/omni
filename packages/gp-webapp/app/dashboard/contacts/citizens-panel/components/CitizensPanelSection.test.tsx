import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useServeCitizenPanelsFlag } from '@shared/experiments/serveCitizenPanelsFlag'
import { useContactsTable } from '../../crm/ContactsTableProvider'
import { CitizensPanelSection } from './CitizensPanelSection'

vi.mock('../../crm/ContactsTableProvider', () => ({
  useContactsTable: vi.fn(),
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'eo-test-org' }),
}))
vi.mock('@shared/experiments/serveCitizenPanelsFlag', () => ({
  useServeCitizenPanelsFlag: vi.fn(),
}))

const setContext = ({
  isWinContext = false,
  flagOn = true,
}: { isWinContext?: boolean; flagOn?: boolean } = {}) => {
  vi.mocked(useContactsTable).mockReturnValue({
    isWinContext,
    isWinContextReady: true,
  } as unknown as ReturnType<typeof useContactsTable>)
  vi.mocked(useServeCitizenPanelsFlag).mockReturnValue({
    ready: true,
    enabled: flagOn,
  })
}

beforeEach(() => {
  testQueryClient.clear()
  api.reset()
  vi.clearAllMocks()
  setContext()
})

describe('CitizensPanelSection', () => {
  it("shows the panel's three numbers and links to its page", async () => {
    api.mock('GET /v1/contacts/civic-panel', {
      status: 200,
      data: {
        members: 1240,
        reachedRecently: 300,
        askableNow: 940,
        lastOutreachAt: null,
      },
    })

    render(<CitizensPanelSection />)

    expect(await screen.findByText('1,240')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Your civic panel' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Members')).toBeInTheDocument()
    expect(screen.getByText('Reached in the last 30 days')).toBeInTheDocument()
    expect(screen.getByText('300')).toBeInTheDocument()
    expect(screen.getByText('Can be asked now')).toBeInTheDocument()
    expect(screen.getByText('940')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'See your panel' }),
    ).toHaveAttribute('href', '/dashboard/contacts/citizens-panel')
  })

  it('points to the Chief of Staff when nobody has joined yet', async () => {
    api.mock('GET /v1/contacts/civic-panel', {
      status: 200,
      data: {
        members: 0,
        reachedRecently: 0,
        askableNow: 0,
        lastOutreachAt: null,
      },
    })

    render(<CitizensPanelSection />)

    expect(
      await screen.findByText('Nobody has joined your civic panel yet.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Build your civic panel' }),
    ).toHaveAttribute('href', '/dashboard/chief-of-staff')
    expect(
      screen.queryByRole('link', { name: 'See your panel' }),
    ).not.toBeInTheDocument()
  })

  it('says what to do when the numbers cannot be read', async () => {
    api.mock('GET /v1/contacts/civic-panel', { status: 500, data: {} })

    render(<CitizensPanelSection />)

    expect(
      await screen.findByText(
        "We couldn't load your civic panel. Refresh the page to try again.",
      ),
    ).toBeInTheDocument()
  })

  it('renders nothing and asks for nothing with serve-citizen-panels off', async () => {
    setContext({ flagOn: false })
    const calls = vi.fn()
    api.mock('GET /v1/contacts/civic-panel', () => {
      calls()
      return {
        status: 200,
        data: {
          members: 1,
          reachedRecently: 0,
          askableNow: 1,
          lastOutreachAt: null,
        },
      }
    })

    const { container } = render(<CitizensPanelSection />)

    await waitFor(() => expect(testQueryClient.isFetching()).toBe(0))
    expect(container).toBeEmptyDOMElement()
    expect(calls).not.toHaveBeenCalled()
  })

  it('renders nothing on Win', async () => {
    setContext({ isWinContext: true })

    const { container } = render(<CitizensPanelSection />)

    await waitFor(() => expect(testQueryClient.isFetching()).toBe(0))
    expect(container).toBeEmptyDOMElement()
  })
})
