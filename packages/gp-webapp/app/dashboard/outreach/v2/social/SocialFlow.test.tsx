import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import type {
  SocialAsset,
  SocialAssetPlatform,
  SocialDraftRequest,
  SocialGenerateRequest,
} from '@goodparty_org/contracts'
import { SocialFlow } from './SocialFlow'

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

const draftFor = ({ purpose, tone }: SocialDraftRequest) =>
  `AI draft (${tone}) for ${purpose}`

const mockDraft = () => {
  const calls: SocialDraftRequest[] = []
  api.mock('POST /v1/outreach/social/draft', ({ body }) => {
    calls.push(body)
    return { status: 200, data: { draft: draftFor(body) } }
  })
  return calls
}

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

const awaitComposeDraft = async (expected: string) => {
  expect(
    (await screen.findAllByText('What do you want to say?')).length,
  ).toBeGreaterThan(0)
  await waitFor(() =>
    expect(screen.getByLabelText('Draft message')).toHaveValue(expected),
  )
}

const advanceToPlatforms = async () => {
  await user.click(screen.getByText('Introduce myself'))
  await awaitComposeDraft(
    draftFor({ purpose: 'introduce_myself', tone: 'warm' }),
  )
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
    const draftCalls = mockDraft()
    const generateCalls = mockGenerate()
    api.mock('POST /v1/outreach/social', { status: 200, data: savedDetail })
    const { onSaved } = openFlow()

    // Purpose step: no footer CTA; picking a card advances and requests an
    // AI draft for the default tone.
    expect(
      screen.getAllByText('What do you want to do?').length,
    ).toBeGreaterThan(0)
    expect(
      screen.queryByRole('button', { name: 'Continue' }),
    ).not.toBeInTheDocument()
    await advanceToPlatforms()
    expect(draftCalls).toEqual([{ purpose: 'introduce_myself', tone: 'warm' }])

    // Platforms step: all six on by default.
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    // Share step: generate fires with the confirmed AI draft + platforms.
    await waitFor(() => expect(generateCalls).toHaveLength(1))
    expect(generateCalls[0]?.purpose).toBe('introduce_myself')
    expect(generateCalls[0]?.draftMessage).toBe(
      draftFor({ purpose: 'introduce_myself', tone: 'warm' }),
    )
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
    mockDraft()
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
    mockDraft()
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

  it('shows Undo only after manual typing is replaced by a tone draft, never from presets alone', async () => {
    const draftCalls = mockDraft()
    openFlow()
    await user.click(screen.getByText('Introduce myself'))
    await awaitComposeDraft(
      draftFor({ purpose: 'introduce_myself', tone: 'warm' }),
    )

    // Tone-preset-only interaction: a fresh draft for that tone, no Undo.
    await user.click(screen.getByRole('radio', { name: /Direct/ }))
    await waitFor(() =>
      expect(screen.getByLabelText('Draft message')).toHaveValue(
        draftFor({ purpose: 'introduce_myself', tone: 'direct' }),
      ),
    )
    expect(draftCalls[1]).toEqual({
      purpose: 'introduce_myself',
      tone: 'direct',
    })
    expect(
      screen.queryByRole('button', { name: 'Undo' }),
    ).not.toBeInTheDocument()

    // Manual typing, then a tone draft replaces it: Undo appears + restores.
    const textarea = screen.getByLabelText('Draft message')
    await user.clear(textarea)
    await user.type(textarea, 'My own words')
    await user.click(screen.getByRole('radio', { name: /Warm/ }))
    const undo = await screen.findByRole('button', { name: 'Undo' })
    await waitFor(() =>
      expect(screen.getByLabelText('Draft message')).toHaveValue(
        draftFor({ purpose: 'introduce_myself', tone: 'warm' }),
      ),
    )
    await user.click(undo)
    expect(screen.getByLabelText('Draft message')).toHaveValue('My own words')
  })

  it('keeps the custom purpose fully manual: no draft call, pills never clobber', async () => {
    const draftCalls = mockDraft()
    openFlow()
    await user.click(screen.getByText('Write my own message'))
    await screen.findAllByText('What do you want to say?')

    const textarea = screen.getByLabelText('Draft message')
    expect(textarea).toHaveValue('')
    await user.type(textarea, 'Entirely my words')

    // Tone pills stay visible but must not fire a call or replace the text.
    await user.click(screen.getByRole('radio', { name: /Direct/ }))
    expect(draftCalls).toHaveLength(0)
    expect(screen.getByLabelText('Draft message')).toHaveValue(
      'Entirely my words',
    )
    expect(
      screen.queryByRole('button', { name: 'Regenerate' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Undo' }),
    ).not.toBeInTheDocument()
  })

  it('surfaces a draft failure inline with retry, and typing clears it', async () => {
    api.mock('POST /v1/outreach/social/draft', { status: 500, data: {} })
    openFlow()
    await user.click(screen.getByText('Introduce myself'))

    expect(
      await screen.findByText(/couldn't draft your message/),
    ).toBeInTheDocument()

    // Retry rolls a fresh draft with the current tone.
    const draftCalls = mockDraft()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() =>
      expect(screen.getByLabelText('Draft message')).toHaveValue(
        draftFor({ purpose: 'introduce_myself', tone: 'warm' }),
      ),
    )
    expect(draftCalls).toEqual([{ purpose: 'introduce_myself', tone: 'warm' }])
    expect(
      screen.queryByText(/couldn't draft your message/),
    ).not.toBeInTheDocument()
  })

  it('lets the user type manually after a draft failure, clearing the error', async () => {
    api.mock('POST /v1/outreach/social/draft', { status: 500, data: {} })
    openFlow()
    await user.click(screen.getByText('Introduce myself'))

    expect(
      await screen.findByText(/couldn't draft your message/),
    ).toBeInTheDocument()

    const textarea = screen.getByLabelText('Draft message')
    await user.type(textarea, 'Manual fallback message')
    expect(
      screen.queryByText(/couldn't draft your message/),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })
})
