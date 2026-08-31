import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Theme } from '@radix-ui/themes'
import { SignInLinkButton } from './SignInLinkButton'

// --- Toast mock ---
const mockShowToast = vi.fn()
vi.mock('@/components/Toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}))

// --- Server action mock ---
// The SDK method this action calls is being added in a separate change, so the
// action is mocked here the way ImpersonateButton.test.tsx mocks its own.
const mockCreateSignInLink = vi.fn()
vi.mock('../../actions', () => ({
  createSignInLink: (...args: unknown[]) => mockCreateSignInLink(...args),
}))

// --- window.open mock ---
const mockOpen = vi.fn()
vi.stubGlobal('open', mockOpen)

// --- clipboard mock ---
const mockWriteText = vi.fn()
vi.stubGlobal('navigator', {
  ...navigator,
  clipboard: { writeText: (text: string) => mockWriteText(text) },
})

const WARNING =
  /do not give this link to anyone except the user directly\. it provides unmitigated access to the user's account\./i

const LINK = {
  url: 'https://dev.goodparty.org/sign-in?token=abc123',
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
}

function renderButton(userId = 42) {
  return render(
    <Theme>
      <SignInLinkButton userId={userId} />
    </Theme>
  )
}

async function createLink() {
  await userEvent.click(screen.getByRole('button', { name: /sign-in link/i }))
  return screen.findByRole('dialog')
}

describe('SignInLinkButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWriteText.mockResolvedValue(undefined)
  })

  describe('default state', () => {
    it('renders the button with no dialog open', () => {
      renderButton()

      expect(
        screen.getByRole('button', { name: /sign-in link/i })
      ).not.toBeDisabled()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  describe('on click — success', () => {
    it('calls createSignInLink with the correct userId', async () => {
      mockCreateSignInLink.mockResolvedValue(LINK)

      renderButton(99)
      await createLink()

      expect(mockCreateSignInLink).toHaveBeenCalledWith(99)
    })

    it('shows the returned url in a read-only field', async () => {
      mockCreateSignInLink.mockResolvedValue(LINK)

      renderButton()
      await createLink()

      const field = screen.getByLabelText('Link')
      expect(field).toHaveValue(LINK.url)
      expect(field).toHaveAttribute('readonly')
    })

    it('warns not to give the link to anyone but the user', async () => {
      mockCreateSignInLink.mockResolvedValue(LINK)

      renderButton()
      await createLink()

      expect(screen.getByText(WARNING)).toBeInTheDocument()
    })

    it('describes the expiry in plain words', async () => {
      mockCreateSignInLink.mockResolvedValue(LINK)

      renderButton()
      await createLink()

      expect(
        screen.getByText(/it works once, and expires in 1 hour, at /i)
      ).toBeInTheDocument()
    })

    it('describes a sub-hour expiry in minutes', async () => {
      mockCreateSignInLink.mockResolvedValue({
        ...LINK,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      })

      renderButton()
      await createLink()

      expect(
        screen.getByText(/it works once, and expires in 15 minutes, at /i)
      ).toBeInTheDocument()
    })

    it('does not open a tab', async () => {
      mockCreateSignInLink.mockResolvedValue(LINK)

      renderButton()
      await createLink()

      expect(mockOpen).not.toHaveBeenCalled()
    })

    it('does not show a toast on success', async () => {
      mockCreateSignInLink.mockResolvedValue(LINK)

      renderButton()
      await createLink()

      expect(mockShowToast).not.toHaveBeenCalled()
    })
  })

  describe('copying', () => {
    it('copies the url to the clipboard and confirms it copied', async () => {
      mockCreateSignInLink.mockResolvedValue(LINK)

      renderButton()
      await createLink()
      await userEvent.click(screen.getByRole('button', { name: /copy link/i }))

      expect(mockWriteText).toHaveBeenCalledWith(LINK.url)
      expect(
        await screen.findByRole('button', { name: /copied/i })
      ).toBeInTheDocument()
    })

    it('restates the warning after a successful copy', async () => {
      mockCreateSignInLink.mockResolvedValue(LINK)

      renderButton()
      await createLink()
      await userEvent.click(screen.getByRole('button', { name: /copy link/i }))

      await waitFor(() =>
        expect(mockShowToast).toHaveBeenCalledWith(
          'Link copied. Send it only to the user directly.'
        )
      )
      expect(screen.getByText(WARNING)).toBeInTheDocument()
    })

    it('shows a toast when the clipboard write fails', async () => {
      mockCreateSignInLink.mockResolvedValue(LINK)
      mockWriteText.mockRejectedValue(new Error('denied'))

      renderButton()
      await createLink()
      await userEvent.click(screen.getByRole('button', { name: /copy link/i }))

      await waitFor(() =>
        expect(mockShowToast).toHaveBeenCalledWith(
          'Could not copy the link. Select it and copy manually.',
          'error'
        )
      )
    })
  })

  describe('on click — loading state', () => {
    it('shows Creating link... while the request is in-flight', async () => {
      let resolve: (value: typeof LINK) => void
      mockCreateSignInLink.mockReturnValue(
        new Promise<typeof LINK>((res) => {
          resolve = res
        })
      )

      renderButton()
      await userEvent.click(
        screen.getByRole('button', { name: /sign-in link/i })
      )

      expect(
        await screen.findByRole('button', { name: /creating link/i })
      ).toBeDisabled()

      // Clean up pending promise
      resolve!(LINK)
    })

    it('re-enables the button once the dialog is dismissed', async () => {
      mockCreateSignInLink.mockResolvedValue(LINK)

      renderButton()
      await createLink()
      await userEvent.click(screen.getByRole('button', { name: /done/i }))

      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: /sign-in link/i })
        ).not.toBeDisabled()
      )
    })
  })

  describe('on click — error', () => {
    it('shows the error message in a toast when the action throws an Error', async () => {
      mockCreateSignInLink.mockRejectedValue(new Error('Not authenticated'))

      renderButton()
      await userEvent.click(
        screen.getByRole('button', { name: /sign-in link/i })
      )

      await waitFor(() =>
        expect(mockShowToast).toHaveBeenCalledWith('Not authenticated', 'error')
      )
    })

    it('shows generic fallback toast for non-Error throws', async () => {
      mockCreateSignInLink.mockRejectedValue('unexpected string error')

      renderButton()
      await userEvent.click(
        screen.getByRole('button', { name: /sign-in link/i })
      )

      await waitFor(() =>
        expect(mockShowToast).toHaveBeenCalledWith(
          'Failed to create sign-in link',
          'error'
        )
      )
    })

    it('does not open a dialog or a tab on error', async () => {
      mockCreateSignInLink.mockRejectedValue(new Error('fail'))

      renderButton()
      await userEvent.click(
        screen.getByRole('button', { name: /sign-in link/i })
      )

      await waitFor(() => expect(mockShowToast).toHaveBeenCalled())
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(mockOpen).not.toHaveBeenCalled()
    })

    it('re-enables the button after a failed request', async () => {
      mockCreateSignInLink.mockRejectedValue(new Error('fail'))

      renderButton()
      await userEvent.click(
        screen.getByRole('button', { name: /sign-in link/i })
      )

      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: /sign-in link/i })
        ).not.toBeDisabled()
      )
    })
  })
})
