import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import type {
  SocialAsset,
  SocialAssetPlatform,
  SocialGenerateRequest,
} from '@goodparty_org/contracts'
import { SocialFlow } from './SocialFlow'

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [
    {
      id: 1,
      isPro: true,
      details: { normalizedOffice: 'City Council' },
    },
  ],
}))
vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))
// The asset cards' copy buttons read the snackbar; the flow renders outside
// the app's SnackbarProvider in tests.
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ successSnackbar: vi.fn(), errorSnackbar: vi.fn() }),
}))

const assetFor = (platform: SocialAssetPlatform): SocialAsset => ({
  platform,
  kind:
    platform === 'tiktok' || platform === 'youtube_shorts'
      ? 'video_script'
      : 'post_copy',
  text: `Adapted for ${platform}`,
  caption:
    platform === 'tiktok' || platform === 'youtube_shorts'
      ? `Caption for ${platform}`
      : null,
})

const mockGenerate = () => {
  const calls: SocialGenerateRequest[] = []
  api.mock('POST /v1/outreach/social/generate', ({ body }) => {
    calls.push(body)
    return {
      status: 200,
      data: { assets: body.platforms.map(assetFor) },
    }
  })
  return calls
}

const savedDetail = {
  id: 77,
  createdAt: new Date('2026-08-11T00:00:00Z'),
  updatedAt: new Date('2026-08-11T00:00:00Z'),
  campaignId: 1,
  outreachType: 'socialMedia' as const,
  projectId: null,
  name: 'Introduce myself',
  status: 'completed' as const,
  error: null,
  audienceRequest: null,
  script: null,
  message: null,
  date: null,
  imageUrl: null,
  voterFileFilterId: null,
  doorKnockingRouteId: null,
  phoneListId: null,
  identityId: null,
  didState: null,
  didNpaSubset: [],
  title: null,
  textCount: null,
  billableTextCount: null,
  campaignPlanDueDate: null,
  organizationSlug: null,
  social: {
    purpose: 'introduce_myself',
    draftMessage: 'draft',
    assets: [assetFor('facebook')],
  },
}

const user = userEvent.setup()

const openFlow = () => {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  render(<SocialFlow open onClose={onClose} onSaved={onSaved} />)
  return { onClose, onSaved }
}

const advanceToPlatforms = async () => {
  await user.click(screen.getByText('Introduce myself'))
  expect(
    (await screen.findAllByText('What do you want to say?')).length,
  ).toBeGreaterThan(0)
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  expect(
    (await screen.findAllByText('Where do you want to share it?')).length,
  ).toBeGreaterThan(0)
}

describe('SocialFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('progresses purpose → compose → platforms → share, generates, saves, and shows success', async () => {
    const generateCalls = mockGenerate()
    api.mock('POST /v1/outreach/social', { status: 200, data: savedDetail })
    const { onSaved } = openFlow()

    // Purpose step: no footer CTA; picking a card advances and seeds a draft.
    expect(
      screen.getAllByText('What do you want to do?').length,
    ).toBeGreaterThan(0)
    expect(
      screen.queryByRole('button', { name: 'Continue' }),
    ).not.toBeInTheDocument()
    await advanceToPlatforms()

    // Platforms step: all six on by default.
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    // Share step: generate fires with the confirmed draft + platforms.
    await waitFor(() => expect(generateCalls).toHaveLength(1))
    expect(generateCalls[0]?.purpose).toBe('introduce_myself')
    expect(generateCalls[0]?.platforms).toHaveLength(6)
    expect(await screen.findByText('Adapted for facebook')).toBeInTheDocument()
    expect(screen.getByText('Caption for tiktok')).toBeInTheDocument()

    // Campaign name is auto-suggested from the purpose and editable.
    const nameInput = screen.getByLabelText('Campaign name')
    expect(nameInput).toHaveValue('Introduce myself')

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Your posts are ready!')).toBeInTheDocument()
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ id: 77, outreachType: 'socialMedia' }),
    )
  })

  it('disables Continue on the platforms step until at least one platform is on', async () => {
    mockGenerate()
    openFlow()
    await advanceToPlatforms()

    // The platform tiles are the only aria-pressed buttons in the sheet.
    const pressedCards = () => screen.getAllByRole('button', { pressed: true })
    expect(pressedCards()).toHaveLength(6)

    while (screen.queryAllByRole('button', { pressed: true }).length > 0) {
      const card = screen.getAllByRole('button', { pressed: true })[0]
      await user.click(card as HTMLElement)
    }
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

    const offCard = screen.getAllByRole('button', { pressed: false })[0]
    await user.click(offCard as HTMLElement)
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  it('asks to discard on close once the flow is dirty, and closes silently when pristine', async () => {
    mockGenerate()
    const { onClose } = openFlow()

    // Pristine: Escape closes without a confirm.
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Discard changes?')).not.toBeInTheDocument()

    // Dirty: purpose picked → confirm appears; Keep editing stays open.
    await user.click(screen.getByText('Introduce myself'))
    await user.keyboard('{Escape}')
    expect(await screen.findByText('Discard changes?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    // Discard actually closes.
    await user.keyboard('{Escape}')
    await user.click(await screen.findByRole('button', { name: 'Discard' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('shows Undo only after manual typing is replaced by a tone preset, never from presets alone', async () => {
    mockGenerate()
    openFlow()
    await user.click(screen.getByText('Introduce myself'))
    await screen.findAllByText('What do you want to say?')

    // Tone-preset-only interaction: no Undo.
    await user.click(screen.getByRole('radio', { name: /Direct/ }))
    expect(
      screen.queryByRole('button', { name: 'Undo' }),
    ).not.toBeInTheDocument()

    // Manual typing, then a preset replaces it: Undo appears and restores.
    const textarea = screen.getByLabelText('Draft message')
    await user.clear(textarea)
    await user.type(textarea, 'My own words')
    await user.click(screen.getByRole('radio', { name: /Warm/ }))
    const undo = await screen.findByRole('button', { name: 'Undo' })
    await user.click(undo)
    expect(screen.getByLabelText('Draft message')).toHaveValue('My own words')
  })
})
