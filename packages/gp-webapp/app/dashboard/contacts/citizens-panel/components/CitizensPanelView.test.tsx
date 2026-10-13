import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CivicPanelRepresentation } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { CitizensPanelView } from './CitizensPanelView'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

const SUMMARY = { members: 40, reachedRecently: 15, askableNow: 25 }

const REPRESENTATION: CivicPanelRepresentation = {
  representation: {
    source: 'sample',
    respondentCount: 40,
    groups: [
      {
        dimension: 'housing',
        key: 'renters',
        label: 'Rent their home',
        respondentShare: 0.2,
        districtShare: 0.4,
      },
    ],
  },
}

beforeEach(() => {
  testQueryClient.clear()
  api.reset()
  vi.clearAllMocks()
})

describe('CitizensPanelView', () => {
  it('compares the members with the district', () => {
    render(
      <CitizensPanelView summary={SUMMARY} representation={REPRESENTATION} />,
    )

    expect(screen.getByText('25')).toBeInTheDocument()
    expect(screen.getByText('Rent their home')).toBeInTheDocument()
    expect(
      screen.getByRole('img', {
        name: 'Rent their home: 20 points under. 20% of members, 40% of your district',
      }),
    ).toBeInTheDocument()
  })

  it('withholds the comparison below the minimum number of members', () => {
    render(
      <CitizensPanelView
        summary={{ members: 4, reachedRecently: 0, askableNow: 4 }}
        representation={{ representation: null }}
      />,
    )

    expect(
      screen.getByText(
        'Once your panel has 10 members, you can compare it with your district.',
      ),
    ).toBeInTheDocument()
  })

  it('opens the saved panel list when there is one', async () => {
    const created = vi.fn()
    api.mock('GET /v1/voters/voter-file/filters', {
      status: 200,
      data: [
        { id: 7, name: "Citizens' panel", civicPanelMember: true },
        { id: 8, name: 'Other' },
      ],
    })
    api.mock('POST /v1/voters/voter-file/filter', () => {
      created()
      return { status: 200, data: { id: 9 } }
    })
    render(
      <CitizensPanelView summary={SUMMARY} representation={REPRESENTATION} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'See members' }))

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/dashboard/contacts/lists/7'),
    )
    expect(created).not.toHaveBeenCalled()
  })

  it('saves the panel as a list the first time', async () => {
    const bodies: unknown[] = []
    api.mock('GET /v1/voters/voter-file/filters', { status: 200, data: [] })
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      bodies.push(body)
      return { status: 200, data: { id: 12 } }
    })
    render(
      <CitizensPanelView summary={SUMMARY} representation={REPRESENTATION} />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'See members' }))

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/dashboard/contacts/lists/12'),
    )
    expect(bodies).toEqual([
      { name: "Citizens' panel", civicPanelMember: true },
    ])
  })

  it('points to the Chief of Staff when nobody has joined yet', () => {
    render(
      <CitizensPanelView
        summary={{ members: 0, reachedRecently: 0, askableNow: 0 }}
        representation={{ representation: null }}
      />,
    )

    expect(
      screen.getByRole('link', { name: "Build your citizens' panel" }),
    ).toHaveAttribute('href', '/dashboard/chief-of-staff')
    expect(
      screen.queryByRole('button', { name: 'See members' }),
    ).not.toBeInTheDocument()
  })
})
