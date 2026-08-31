import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import type {
  ServeSocialDraftRequest,
  ServeSocialGenerateRequest,
  SocialAsset,
  SocialAssetPlatform,
} from '@goodparty_org/contracts'
import ConstituentOutreachPage from './ConstituentOutreachPage'
import type { HistoryRow } from 'app/dashboard/outreach/v2/historyStatus.util'

// Desktop history table, scoped so its "Door knocking" channel badge isn't
// confused with the (also-rendered) Door knocking channel card above it.
const desktopTable = () => screen.getAllByRole('table')[0] as HTMLElement

vi.mock('@shared/experiments/FeatureFlagsProvider', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@shared/experiments/FeatureFlagsProvider')
  >()),
  useFlagOn: () => ({ ready: true, on: true }),
}))

// The real layout is a sidebar shell that needs an OrganizationProvider this
// suite has no use for — a stub keeps the focus on the content it wraps.
vi.mock('app/dashboard/shared/DashboardLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('helpers/analyticsHelper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('helpers/analyticsHelper')>()),
  trackEvent: vi.fn(),
}))

// The compose step mounts dictation unconditionally — same precedent as
// SocialFlow.test.tsx / PhoneBankingFlow.test.tsx.
vi.mock('app/dashboard/shared/dictation/useDictationAppend', () => ({
  useDictationAppend: () => ({
    status: 'idle' as const,
    error: null,
    partialTranscript: '',
    active: false,
    busy: false,
    start: vi.fn(),
    stop: vi.fn(),
    toggle: vi.fn(),
  }),
}))

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({
    displaySnackbar: vi.fn(),
    successSnackbar: vi.fn(),
    errorSnackbar: vi.fn(),
  }),
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

const draftFor = ({ purpose, tone }: ServeSocialDraftRequest) =>
  `AI draft (${tone}) for ${purpose}`

const mockServeDraft = () => {
  const calls: ServeSocialDraftRequest[] = []
  api.mock('POST /v1/outreach/serve/social/draft', ({ body }) => {
    calls.push(body)
    return { status: 200, data: { draft: draftFor(body) } }
  })
  return calls
}

const mockServeGenerate = () => {
  const calls: ServeSocialGenerateRequest[] = []
  api.mock('POST /v1/outreach/serve/social/generate', ({ body }) => {
    calls.push(body)
    return { status: 200, data: { assets: body.platforms.map(assetFor) } }
  })
  return calls
}

const savedDetail = {
  id: 77,
  createdAt: new Date('2026-08-30T00:00:00Z'),
  updatedAt: new Date('2026-08-30T00:00:00Z'),
  campaignId: null,
  outreachType: 'socialMedia' as const,
  projectId: null,
  name: 'Introduction posts',
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
  organizationSlug: 'eo-test-org',
  archivedAt: null,
  social: {
    purpose: 'introduce_myself',
    draftMessage: 'draft',
    assets: [assetFor('facebook')],
  },
}

const user = userEvent.setup()

describe('ConstituentOutreachPage — Serve outreach history', () => {
  it('renders seeded outreach rows (channel, name, status, date)', () => {
    const outreaches: HistoryRow[] = [
      {
        id: 1,
        date: '2026-08-20',
        outreachType: 'nativeDoorKnocking',
        name: 'Elm & Cedar walk',
        status: 'in_progress',
      },
    ]

    render(<ConstituentOutreachPage outreaches={outreaches} />)

    const table = within(desktopTable())
    expect(table.getByText('Elm & Cedar walk')).toBeInTheDocument()
    expect(table.getByText('Door knocking')).toBeInTheDocument()
    expect(table.getByText('In progress')).toBeInTheDocument()
  })

  // Only the social card is wired (ENG-10970) — no other Serve channel
  // produces a row yet, so a non-social row must not present as a dead
  // clickable element (no role="button", no tabIndex, no pointer cursor).
  it('renders a non-social row as plain, non-interactive content', () => {
    const outreaches: HistoryRow[] = [
      {
        id: 1,
        date: '2026-08-20',
        outreachType: 'nativeDoorKnocking',
        name: 'Elm & Cedar walk',
        status: 'in_progress',
      },
    ]

    render(<ConstituentOutreachPage outreaches={outreaches} />)

    const row = within(desktopTable())
      .getByText('Elm & Cedar walk')
      .closest('tr')
    expect(row).not.toHaveAttribute('role', 'button')
    expect(row).not.toHaveAttribute('tabindex')
  })

  it('renders a clean empty state with no rows', () => {
    render(<ConstituentOutreachPage outreaches={[]} />)

    // The history table renders both a desktop table and a mobile card list
    // (one hidden via CSS, not removed from the DOM), so the empty message
    // appears twice.
    expect(
      screen.getAllByText(
        'No campaigns yet. Pick a channel above to create your first.',
      ),
    ).toHaveLength(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('opens the social flow (serve surface) when the enabled card is clicked, and the other two cards stay inert', async () => {
    render(<ConstituentOutreachPage outreaches={[]} />)

    expect(screen.getByRole('button', { name: /Phone banking/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Door knocking/ })).toBeDisabled()

    await user.click(screen.getByText('Social media'))

    // A serve-only purpose card proves SERVE_SOCIAL_SURFACE (not Win's) is
    // wired in — Win's PurposeStep has no "Explain a recent decision" card.
    expect(
      await screen.findByText('Explain a recent decision'),
    ).toBeInTheDocument()
  })

  it('onSaved seeds the new row into history without a page reload', async () => {
    mockServeDraft()
    mockServeGenerate()
    api.mock('POST /v1/outreach/serve/social', {
      status: 200,
      data: savedDetail,
    })

    render(<ConstituentOutreachPage outreaches={[]} />)

    await user.click(screen.getByText('Social media'))
    await user.click(await screen.findByText('Introduce myself'))
    await waitFor(() =>
      expect(screen.getByLabelText('Draft message')).toHaveValue(
        draftFor({ purpose: 'introduce_myself', tone: 'warm' }),
      ),
    )
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(
      (await screen.findAllByText('Where do you want to share it?')).length,
    ).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Adapted for facebook')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Your posts are ready!')).toBeInTheDocument()

    // The row is already in history the moment save succeeds — a plain text
    // query (not role-scoped) finds it even while the flow sheet still
    // occupies the accessibility tree, since the row was seeded via state,
    // not a refetch of the list route. Both the desktop table and the mobile
    // card list render it (one hidden via CSS, not removed from the DOM).
    expect(await screen.findAllByText('Introduction posts')).toHaveLength(2)
  })

  it('clicking a saved social row opens the drawer against the serve detail route', async () => {
    let serveDetailCalls = 0
    api.mock('GET /v1/outreach/serve/:id', ({ params }) => {
      serveDetailCalls += 1
      expect(params.id).toBe('77')
      return { status: 200, data: savedDetail }
    })

    const outreaches: HistoryRow[] = [
      {
        id: 77,
        createdAt: '2026-08-30T00:00:00Z',
        outreachType: 'socialMedia',
        name: 'Introduction posts',
        status: 'completed',
      },
    ]
    render(<ConstituentOutreachPage outreaches={outreaches} />)

    const table = within(desktopTable())
    await user.click(table.getByText('Introduction posts'))

    // Only the serve detail route is mocked — if the drawer called the Win
    // route instead, this fetch would go unmocked and the query would error.
    expect(await screen.findByText('Adapted for facebook')).toBeInTheDocument()
    expect(serveDetailCalls).toBeGreaterThan(0)
    expect(
      screen.queryByText(/couldn't load this campaign's posts/),
    ).not.toBeInTheDocument()
  })

  it('archives a saved social row from the drawer', async () => {
    api.mock('GET /v1/outreach/serve/:id', {
      status: 200,
      data: savedDetail,
    })
    let archiveBody: unknown
    api.mock('PATCH /v1/outreach/:id/archive', ({ params, body }) => {
      archiveBody = body
      expect(params.id).toBe('77')
      return {
        status: 200,
        data: { id: 77, archivedAt: new Date('2026-08-30T00:00:00Z') },
      }
    })

    const outreaches: HistoryRow[] = [
      {
        id: 77,
        createdAt: '2026-08-30T00:00:00Z',
        outreachType: 'socialMedia',
        name: 'Introduction posts',
        status: 'completed',
      },
    ]
    render(<ConstituentOutreachPage outreaches={outreaches} />)

    const table = within(desktopTable())
    await user.click(table.getByText('Introduction posts'))

    await user.click(
      await screen.findByRole('button', { name: 'Move to archive' }),
    )

    expect(archiveBody).toEqual({ archived: true })
  })
})
