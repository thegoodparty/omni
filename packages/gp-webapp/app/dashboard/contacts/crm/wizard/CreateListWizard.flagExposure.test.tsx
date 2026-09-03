import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { useSnackbar } from 'helpers/useSnackbar'
import { WIN_RECOMMENDED_LISTS_FLAG_KEY } from '@shared/experiments/winRecommendedListsFlag'
import CreateListWizard from './CreateListWizard'
import { useContactsTable } from '../ContactsTableProvider'

vi.mock('../ContactsTableProvider', () => ({
  useContactsTable: vi.fn(),
}))
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: vi.fn(),
}))
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({ slug: 'test-org' }),
}))
vi.mock('@shared/experiments/FeatureFlagsProvider', () => ({
  useFlagOn: vi.fn(),
  useFeatureFlags: vi.fn(),
}))

const { useFlagOn, useFeatureFlags } =
  await import('@shared/experiments/FeatureFlagsProvider')
const mockedUseContactsTable = vi.mocked(useContactsTable)
const mockedUseSnackbar = vi.mocked(useSnackbar)
const mockedUseFlagOn = vi.mocked(useFlagOn)
const mockedUseFeatureFlags = vi.mocked(useFeatureFlags)

const exposure = vi.fn()

const exposureCalls = () =>
  exposure.mock.calls.filter(([key]) => key === WIN_RECOMMENDED_LISTS_FLAG_KEY)

const setFlag = ({
  ready = true,
  on = true,
}: {
  ready?: boolean
  on?: boolean
}) => {
  mockedUseFlagOn.mockReturnValue({ ready, on })
}

const gotoVoterFileStep = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(
    screen.getByRole('radio', {
      name: /build a list using voter demographics and data/i,
    }),
  )
  await user.click(screen.getByRole('button', { name: 'Continue' }))
}

beforeEach(() => {
  api.reset()
  vi.clearAllMocks()
  mockedUseSnackbar.mockReturnValue({
    successSnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
    displaySnackbar: vi.fn(),
  })
  mockedUseFeatureFlags.mockReturnValue({
    ready: true,
    variant: () => ({ value: undefined }),
    all: () => ({}),
    exposure,
    refresh: vi.fn(),
    clear: vi.fn(),
  } as ReturnType<typeof useFeatureFlags>)
  mockedUseContactsTable.mockReturnValue({
    isElectedOfficial: false,
    isWinContext: true,
    isWinContextReady: true,
    refreshCustomSegments: vi.fn().mockResolvedValue(undefined),
    selectList: vi.fn(),
    customSegments: [],
  } as unknown as ReturnType<typeof useContactsTable>)
  setFlag({})
  api.mock('GET /v1/outreach', { status: 200, data: [] })
  api.mock('POST /v1/contacts/count', { status: 200, data: { count: 250 } })
})

// The wizard is mounted for the whole contacts page and only toggles `open`,
// so an exposure read at the component's top level counted every page view.
// The groups render on the voter-file filter step alone, which makes that step
// the treatment/control divergence point.
describe('CreateListWizard — win-recommended-lists exposure', () => {
  it('records no exposure while the wizard is closed', () => {
    render(<CreateListWizard open={false} onOpenChange={vi.fn()} />)

    expect(exposureCalls()).toHaveLength(0)
  })

  // The bug this replaced: reading the flag with exposure on, at a component
  // that never unmounts. Pinned on the call itself, since useFlagOn is what
  // fires the early exposure and it is mocked out here.
  it('reads the flag without arming the hook-level exposure', () => {
    render(<CreateListWizard open={false} onOpenChange={vi.fn()} />)

    expect(mockedUseFlagOn).toHaveBeenCalledWith(
      WIN_RECOMMENDED_LISTS_FLAG_KEY,
      { trackExposure: false },
    )
  })

  it('records no exposure on the branch step', () => {
    render(<CreateListWizard open onOpenChange={vi.fn()} />)

    expect(exposureCalls()).toHaveLength(0)
  })

  it('records the exposure once the voter-file filter step renders', async () => {
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)
    await gotoVoterFileStep(user)

    expect(exposureCalls()).toHaveLength(1)
  })

  // Exposure keys on reaching the step, never on the flag's value — a control
  // user who sees the step without the groups is just as exposed, and an
  // experiment measured off treatment-only exposures is unreadable.
  it('records the exposure for the control arm too', async () => {
    setFlag({ on: false })
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)
    await gotoVoterFileStep(user)

    expect(exposureCalls()).toHaveLength(1)
  })

  // trackExposure dedupes by key forever, so one recorded before the variants
  // resolve would swallow the real exposure that follows.
  it('waits for the flag to settle before recording', async () => {
    setFlag({ ready: false })
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)
    await gotoVoterFileStep(user)

    expect(exposureCalls()).toHaveLength(0)
  })

  it('records no exposure on the activity branch, which renders no groups', async () => {
    const user = userEvent.setup()
    render(<CreateListWizard open onOpenChange={vi.fn()} />)
    await user.click(
      screen.getByRole('radio', { name: /previous outreach|activity/i }),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(exposureCalls()).toHaveLength(0)
  })
})
