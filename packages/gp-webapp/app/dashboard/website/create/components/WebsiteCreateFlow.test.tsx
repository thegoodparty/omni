import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import type { Website } from 'helpers/types'
import { WebsiteProvider } from '../../components/WebsiteProvider'

const push = vi.fn()
const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
  usePathname: () => '/',
}))

vi.mock('../../editor/components/WebsitePreview', () => ({
  default: () => null,
}))
vi.mock('../../editor/components/WebsiteEditorPageStepper', () => ({
  default: () => null,
}))
vi.mock('../../editor/components/VanityPathStep', () => ({
  default: () => null,
}))
vi.mock('../../editor/components/LogoStep', () => ({ default: () => null }))
vi.mock('../../editor/components/ThemeStep', () => ({ default: () => null }))
vi.mock('../../editor/components/HeroStep', () => ({ default: () => null }))
vi.mock('../../editor/components/AboutStep', () => ({
  default: () => null,
  MIN_BIO_LENGTH: 50,
}))
vi.mock('../../editor/components/ContactStep', () => ({ default: () => null }))
vi.mock('../../editor/components/CompleteStep', () => ({ default: () => null }))
vi.mock('@shared/utils/ResponsiveModal', () => ({ default: () => null }))

const updateWebsiteMock = vi.fn()
vi.mock('../../util/website.util', () => ({
  updateWebsite: (...args: unknown[]) => updateWebsiteMock(...args),
  WEBSITE_STATUS: { published: 'published', unpublished: 'unpublished' },
}))

vi.mock('app/onboarding/shared/ajaxActions', () => ({
  updateCampaign: vi.fn(),
}))

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    successSnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
    displaySnackbar: vi.fn(),
  }),
}))

import WebsiteCreateFlow from './WebsiteCreateFlow'

const website: Website = {
  id: 1,
  vanityPath: 'jane-doe',
  status: 'unpublished',
  content: {
    createStep: '1',
    contact: { email: 'jane@example.com', phone: '5551234567' },
    main: { title: 'Jane Doe' },
    about: { bio: 'Bio', issues: [] },
  },
}

const renderFlow = () =>
  render(
    <WebsiteProvider website={website} contacts={[]}>
      <WebsiteCreateFlow />
    </WebsiteProvider>,
  )

beforeEach(() => {
  vi.clearAllMocks()
})

describe('<WebsiteCreateFlow>', () => {
  it('navigates to the website dashboard via router after a successful save & exit', async () => {
    updateWebsiteMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      data: { ...website },
    })

    renderFlow()

    await userEvent.click(screen.getByRole('button', { name: /save.*exit/i }))

    await waitFor(() => expect(updateWebsiteMock).toHaveBeenCalled())
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard/website'))
    expect(refresh).toHaveBeenCalled()
  })

  it('does not navigate when save fails', async () => {
    updateWebsiteMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      data: null,
    })

    renderFlow()

    await userEvent.click(screen.getByRole('button', { name: /save.*exit/i }))

    await waitFor(() => expect(updateWebsiteMock).toHaveBeenCalled())
    expect(push).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })
})
