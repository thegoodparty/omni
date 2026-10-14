import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useQuery } from '@tanstack/react-query'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useOrganization } from '@shared/organization-picker'
import { useSnackbar } from 'helpers/useSnackbar'
import { useServeCitizenPanelsFlag } from 'app/shared/experiments/serveCitizenPanelsFlag'
import CivicPanelRow from './CivicPanelRow'
import { makePerson } from '../shared/test-fixtures'
import type { Person, UpdateCivicPanelInput } from '../shared/contacts-types'

vi.mock('@shared/organization-picker', () => ({
  useOrganization: vi.fn(),
}))

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: vi.fn(),
}))

vi.mock('app/shared/experiments/serveCitizenPanelsFlag', () => ({
  useServeCitizenPanelsFlag: vi.fn(),
}))

const ORG_SLUG = 'eo-org-1'
const TOGGLE = 'On your civic panel'

const errorSnackbar = vi.fn()

function Harness({
  initialPerson,
  isServe = true,
}: {
  initialPerson: Person
  isServe?: boolean
}) {
  const { data: person } = useQuery({
    queryKey: ['person', ORG_SLUG, initialPerson.id],
    queryFn: () => initialPerson,
    initialData: initialPerson,
    staleTime: Infinity,
  })
  return <CivicPanelRow person={person!} isServe={isServe} />
}

describe('<CivicPanelRow>', () => {
  beforeEach(() => {
    errorSnackbar.mockClear()
    vi.mocked(useServeCitizenPanelsFlag).mockReturnValue({
      ready: true,
      enabled: true,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useOrganization).mockReturnValue({ slug: ORG_SLUG } as any)
    vi.mocked(useSnackbar).mockReturnValue({
      displaySnackbar: vi.fn(),
      errorSnackbar,
      successSnackbar: vi.fn(),
    })
  })

  it('renders nothing for Win', () => {
    render(
      <Harness
        initialPerson={makePerson({ civicPanel: 'member' })}
        isServe={false}
      />,
    )

    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('renders nothing with serve-citizen-panels off', () => {
    vi.mocked(useServeCitizenPanelsFlag).mockReturnValue({
      ready: true,
      enabled: false,
    })
    render(<Harness initialPerson={makePerson({ civicPanel: 'member' })} />)

    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('reads off until the person joins', () => {
    render(<Harness initialPerson={makePerson()} />)

    expect(screen.getByRole('switch', { name: TOGGLE })).not.toBeChecked()
  })

  it('joining PATCHes member and shows it straight away', async () => {
    const user = userEvent.setup()
    let lastPatchBody: UpdateCivicPanelInput | null = null
    api.mock('PATCH /v1/contacts/:personId/civic-panel', ({ body }) => {
      lastPatchBody = body
      return { status: 200, data: { civicPanel: 'member' } }
    })

    render(<Harness initialPerson={makePerson({ civicPanel: 'left' })} />)

    await user.click(screen.getByRole('switch', { name: TOGGLE }))

    expect(screen.getByRole('switch', { name: TOGGLE })).toBeChecked()
    await waitFor(() => expect(lastPatchBody).toEqual({ value: 'member' }))
  })

  it('rolls back and says so when the save fails', async () => {
    const user = userEvent.setup()
    api.mock('PATCH /v1/contacts/:personId/civic-panel', {
      status: 500,
      data: {},
    })

    render(<Harness initialPerson={makePerson({ civicPanel: 'left' })} />)

    await user.click(screen.getByRole('switch', { name: TOGGLE }))

    await waitFor(() => expect(errorSnackbar).toHaveBeenCalled())
    expect(screen.getByRole('switch', { name: TOGGLE })).not.toBeChecked()
  })
})
