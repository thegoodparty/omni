import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { P2P_SCRIPT_MAX_LENGTH } from '@goodparty_org/contracts'
import { GenerateReviewScreen } from './GenerateReviewScreen'

vi.mock('app/shared/utils/RichEditor', async () => ({
  default: (await import('helpers/test-utils/RichEditorMock')).RichEditorMock,
}))

const { getCampaign, updateCampaign } = vi.hoisted(() => ({
  getCampaign: vi.fn(),
  updateCampaign: vi.fn(),
}))

vi.mock('app/onboarding/shared/ajaxActions', () => ({
  getCampaign,
  updateCampaign,
}))

const errorSnackbar = vi.fn()
vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ errorSnackbar, successSnackbar: vi.fn() }),
}))

const mockCampaignWithScript = (content: string) => {
  getCampaign.mockResolvedValue({
    aiContent: {
      smsScript: { name: 'SMS Script', content, updatedAt: 0 },
    },
  })
}

describe('GenerateReviewScreen', () => {
  beforeEach(() => {
    getCampaign.mockReset()
    updateCampaign.mockReset()
  })

  it('shows the character count and enables Save under the limit', async () => {
    mockCampaignWithScript('Hello voters')
    render(
      <GenerateReviewScreen
        aiScriptKey="smsScript"
        maxScriptLength={P2P_SCRIPT_MAX_LENGTH}
      />,
    )

    expect(
      await screen.findByText(`12 / ${P2P_SCRIPT_MAX_LENGTH}`),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('counts the sanitized plain text, not the raw HTML', async () => {
    mockCampaignWithScript('<p>Hello voters</p>')
    render(
      <GenerateReviewScreen
        aiScriptKey="smsScript"
        maxScriptLength={P2P_SCRIPT_MAX_LENGTH}
      />,
    )

    expect(
      await screen.findByText(`12 / ${P2P_SCRIPT_MAX_LENGTH}`),
    ).toBeInTheDocument()
  })

  it('disables Save when the script exceeds the limit', async () => {
    mockCampaignWithScript('x'.repeat(P2P_SCRIPT_MAX_LENGTH + 1))
    render(
      <GenerateReviewScreen
        aiScriptKey="smsScript"
        maxScriptLength={P2P_SCRIPT_MAX_LENGTH}
      />,
    )

    expect(
      await screen.findByText(
        `${P2P_SCRIPT_MAX_LENGTH + 1} / ${P2P_SCRIPT_MAX_LENGTH}`,
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(await screen.findByTestId('rich-editor')).toHaveAttribute(
      'data-error',
      'true',
    )
  })

  it('applies no limit when maxScriptLength is omitted (non-texting flows)', async () => {
    mockCampaignWithScript('x'.repeat(P2P_SCRIPT_MAX_LENGTH + 1))
    render(<GenerateReviewScreen aiScriptKey="smsScript" />)

    expect(await screen.findByTestId('rich-editor')).toHaveAttribute(
      'data-error',
      'false',
    )
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(screen.queryByText(/\/ \d+$/)).not.toBeInTheDocument()
  })
})
