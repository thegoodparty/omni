import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import type {
  SocialAsset,
  SocialAssetPlatform,
  SocialDraftRequest,
  SocialGenerateRequest,
} from '@goodparty_org/contracts'
import type { UseDictationAppendInput } from 'app/dashboard/shared/dictation/useDictationAppend'
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

// Capture the compose step's dictation wiring so tests can feed transcript
// appends through the same onChange path the real append hook uses.
let dictationInput: UseDictationAppendInput | null = null
vi.mock('app/dashboard/shared/dictation/useDictationAppend', () => ({
  useDictationAppend: (input: UseDictationAppendInput) => {
    dictationInput = input
    return {
      status: 'idle' as const,
      error: null,
      partialTranscript: '',
      active: false,
      busy: false,
      start: vi.fn(),
      stop: vi.fn(),
      toggle: vi.fn(),
    }
  },
}))

const dictate = (chunk: string) => {
  const input = dictationInput as UseDictationAppendInput | null
  if (!input) throw new Error('dictation not mounted')
  const sep = input.value.length > 0 && !input.value.endsWith(' ') ? ' ' : ''
  act(() => input.onChange(input.value + sep + chunk))
}

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

const draftFor = ({ purpose, tone, currentDraft }: SocialDraftRequest) =>
  currentDraft === undefined
    ? `AI draft (${tone}) for ${purpose}`
    : `Improved (${tone}): ${currentDraft}`

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
    dictationInput = null
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

  it('re-generates with the updated platform set after Back-and-edit from share', async () => {
    mockDraft()
    const generateCalls = mockGenerate()
    openFlow()
    await advanceToPlatforms()

    // Reach the share step: one generate call with all six platforms.
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(generateCalls).toHaveLength(1))
    expect(generateCalls[0]?.platforms).toHaveLength(6)
    expect(await screen.findByText('Adapted for facebook')).toBeInTheDocument()

    // Back to platforms, drop one platform (invalidateAssets clears the
    // generated set), continue again: a SECOND generate call fires with the
    // reduced platform list — the assets never go stale silently.
    await user.click(
      screen.getAllByRole('button', { name: 'Back' })[0] as HTMLElement,
    )
    const onCard = screen.getAllByRole('button', { pressed: true })[0]
    await user.click(onCard as HTMLElement)
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(generateCalls).toHaveLength(2))
    expect(generateCalls[1]?.platforms).toHaveLength(5)
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

    // While the confirm is up, further drawer dismiss attempts are swallowed
    // (a real pointerdown on the confirm lands outside the vaul content and
    // fires one) — the loop that made Keep editing reopen the confirm
    // forever. The sheet's own Close button is such a dismiss; it's
    // aria-hidden behind the modal confirm, so fireEvent reaches it the way
    // a real outside pointerdown does.
    const sheetClose = Array.from(document.querySelectorAll('button')).find(
      (b) =>
        b.getAttribute('aria-label') === 'Close' ||
        b.textContent?.trim() === 'Close',
    )
    fireEvent.click(sheetClose as HTMLElement)
    expect(screen.getAllByText('Discard changes?')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Discard changes?')).not.toBeInTheDocument()

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

    // Manual typing, then a NEWLY GENERATED tone draft replaces it: Undo
    // appears + restores. (An uncached tone — cached switches restore from
    // memory and never clobber, so they never need Undo.)
    const textarea = screen.getByLabelText('Draft message')
    await user.clear(textarea)
    await user.type(textarea, 'My own words')
    await user.click(screen.getByRole('radio', { name: /Urgent/ }))
    const undo = await screen.findByRole('button', { name: 'Undo' })
    await waitFor(() =>
      expect(screen.getByLabelText('Draft message')).toHaveValue(
        draftFor({ purpose: 'introduce_myself', tone: 'urgent' }),
      ),
    )
    await user.click(undo)
    expect(screen.getByLabelText('Draft message')).toHaveValue('My own words')
  })

  it('restores previously generated tones from memory; only Regenerate refetches', async () => {
    const draftCalls = mockDraft()
    openFlow()
    await user.click(screen.getByText('Introduce myself'))
    await awaitComposeDraft(
      draftFor({ purpose: 'introduce_myself', tone: 'warm' }),
    )

    await user.click(screen.getByRole('radio', { name: /Direct/ }))
    await waitFor(() =>
      expect(screen.getByLabelText('Draft message')).toHaveValue(
        draftFor({ purpose: 'introduce_myself', tone: 'direct' }),
      ),
    )
    expect(draftCalls).toHaveLength(2)

    // Back to warm: served from memory, no third call.
    await user.click(screen.getByRole('radio', { name: /Warm/ }))
    expect(screen.getByLabelText('Draft message')).toHaveValue(
      draftFor({ purpose: 'introduce_myself', tone: 'warm' }),
    )
    expect(draftCalls).toHaveLength(2)

    // Manual edits are part of the tone's memory when switching away.
    const textarea = screen.getByLabelText('Draft message')
    await user.clear(textarea)
    await user.type(textarea, 'Warm but mine')
    await user.click(screen.getByRole('radio', { name: /Direct/ }))
    expect(draftCalls).toHaveLength(2)
    await user.click(screen.getByRole('radio', { name: /Warm/ }))
    expect(screen.getByLabelText('Draft message')).toHaveValue('Warm but mine')
    expect(draftCalls).toHaveLength(2)

    // Regenerate is the only path that refetches an already-drafted tone.
    await user.click(screen.getByRole('button', { name: /Regenerate/ }))
    await waitFor(() => expect(draftCalls).toHaveLength(3))
    expect(draftCalls[2]).toEqual({
      purpose: 'introduce_myself',
      tone: 'warm',
    })
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

  it('shows Improve with AI only after manual typing; improving replaces with Undo + tone memory', async () => {
    const draftCalls = mockDraft()
    openFlow()
    await user.click(screen.getByText('Introduce myself'))
    await awaitComposeDraft(
      draftFor({ purpose: 'introduce_myself', tone: 'warm' }),
    )

    // AI-only text (purpose pick / tone presets) never offers Improve.
    expect(
      screen.queryByRole('button', { name: /Improve with AI/ }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /Direct/ }))
    await waitFor(() =>
      expect(screen.getByLabelText('Draft message')).toHaveValue(
        draftFor({ purpose: 'introduce_myself', tone: 'direct' }),
      ),
    )
    expect(
      screen.queryByRole('button', { name: /Improve with AI/ }),
    ).not.toBeInTheDocument()

    const textarea = screen.getByLabelText('Draft message')
    await user.clear(textarea)
    await user.type(textarea, 'My own words')
    await user.click(
      await screen.findByRole('button', { name: /Improve with AI/ }),
    )

    await waitFor(() =>
      expect(screen.getByLabelText('Draft message')).toHaveValue(
        'Improved (direct): My own words',
      ),
    )
    expect(draftCalls[2]).toEqual({
      purpose: 'introduce_myself',
      tone: 'direct',
      currentDraft: 'My own words',
    })

    // The polished result is generated text: Improve retreats until the
    // user edits again.
    expect(
      screen.queryByRole('button', { name: /Improve with AI/ }),
    ).not.toBeInTheDocument()

    // The polish fed the current tone's memory: leaving and returning
    // restores it without another call.
    await user.click(screen.getByRole('radio', { name: /Warm/ }))
    expect(screen.getByLabelText('Draft message')).toHaveValue(
      draftFor({ purpose: 'introduce_myself', tone: 'warm' }),
    )
    await user.click(screen.getByRole('radio', { name: /Direct/ }))
    expect(screen.getByLabelText('Draft message')).toHaveValue(
      'Improved (direct): My own words',
    )
    expect(draftCalls).toHaveLength(3)

    // Undo still holds the pre-improve manual words.
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByLabelText('Draft message')).toHaveValue('My own words')
    expect(
      screen.getByRole('button', { name: /Improve with AI/ }),
    ).toBeInTheDocument()
  })

  it('treats dictation as manual input: clears errors, shows Improve, and improves the dictated text', async () => {
    api.mock('POST /v1/outreach/social/draft', { status: 500, data: {} })
    openFlow()
    await user.click(screen.getByText('Introduce myself'))
    expect(
      await screen.findByText(/couldn't draft your message/),
    ).toBeInTheDocument()

    expect(dictationInput?.analyticsLabel).toBe('outreach-social-compose')
    expect(
      screen.getByRole('button', { name: 'Dictate message' }),
    ).toBeInTheDocument()

    // A dictated chunk lands like typing: error cleared, Improve available.
    dictate('Spoken opener')
    expect(
      screen.queryByText(/couldn't draft your message/),
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText('Draft message')).toHaveValue('Spoken opener')

    const draftCalls = mockDraft()
    await user.click(screen.getByRole('button', { name: /Improve with AI/ }))
    await waitFor(() =>
      expect(screen.getByLabelText('Draft message')).toHaveValue(
        'Improved (warm): Spoken opener',
      ),
    )
    expect(draftCalls).toEqual([
      {
        purpose: 'introduce_myself',
        tone: 'warm',
        currentDraft: 'Spoken opener',
      },
    ])
  })

  it('feeds dictated text into per-tone memory on switch-away', async () => {
    const draftCalls = mockDraft()
    openFlow()
    await user.click(screen.getByText('Introduce myself'))
    await awaitComposeDraft(
      draftFor({ purpose: 'introduce_myself', tone: 'warm' }),
    )

    dictate('Also spoken')
    const dictated = `${draftFor({
      purpose: 'introduce_myself',
      tone: 'warm',
    })} Also spoken`
    expect(screen.getByLabelText('Draft message')).toHaveValue(dictated)

    // Dictated words are manual: the generated direct draft snapshots Undo.
    await user.click(screen.getByRole('radio', { name: /Direct/ }))
    await waitFor(() =>
      expect(screen.getByLabelText('Draft message')).toHaveValue(
        draftFor({ purpose: 'introduce_myself', tone: 'direct' }),
      ),
    )
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /Warm/ }))
    expect(screen.getByLabelText('Draft message')).toHaveValue(dictated)
    expect(draftCalls).toHaveLength(2)
  })

  it('allows Improve with AI for the custom purpose, with Undo', async () => {
    const draftCalls = mockDraft()
    openFlow()
    await user.click(screen.getByText('Write my own message'))
    await screen.findAllByText('What do you want to say?')

    await user.type(screen.getByLabelText('Draft message'), 'Entirely my words')
    expect(draftCalls).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: /Improve with AI/ }))
    await waitFor(() =>
      expect(screen.getByLabelText('Draft message')).toHaveValue(
        'Improved (warm): Entirely my words',
      ),
    )
    expect(draftCalls).toEqual([
      { purpose: 'custom', tone: 'warm', currentDraft: 'Entirely my words' },
    ])

    // Regenerate stays hidden for custom; Undo restores the manual text.
    expect(
      screen.queryByRole('button', { name: /Regenerate/ }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByLabelText('Draft message')).toHaveValue(
      'Entirely my words',
    )
  })

  it('retries a failed custom-purpose improve through the error card', async () => {
    api.mock('POST /v1/outreach/social/draft', { status: 500, data: {} })
    openFlow()
    await user.click(screen.getByText('Write my own message'))
    await screen.findAllByText('What do you want to say?')

    await user.type(screen.getByLabelText('Draft message'), 'Rough words')
    await user.click(screen.getByRole('button', { name: /Improve with AI/ }))
    expect(
      await screen.findByText(/couldn't draft your message/),
    ).toBeInTheDocument()

    const draftCalls = mockDraft()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() =>
      expect(screen.getByLabelText('Draft message')).toHaveValue(
        'Improved (warm): Rough words',
      ),
    )
    expect(draftCalls).toEqual([
      { purpose: 'custom', tone: 'warm', currentDraft: 'Rough words' },
    ])
  })
})
