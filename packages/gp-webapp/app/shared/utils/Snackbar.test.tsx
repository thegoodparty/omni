'use client'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from 'helpers/test-utils/render'
import { screen, fireEvent } from '@testing-library/react'
import { SnackbarProvider, useSnackbar } from '@shared/utils/Snackbar'

// Mutable so individual tests can move "the current route" between the CRM
// contacts page (where AssistantBar.tsx pins a bar to the bottom) and any
// other page, to assert Snackbar.tsx's offset scoping (ENG-10782).
let mockPathname = '/'

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

beforeEach(() => {
  mockPathname = '/'
})

const HarnessComponent = () => {
  const { successSnackbar } = useSnackbar()
  return <button onClick={() => successSnackbar('Saved!')}>Show Toast</button>
}

const ErrorHarnessComponent = () => {
  const { errorSnackbar } = useSnackbar()
  return (
    <button onClick={() => errorSnackbar('Something went wrong!')}>
      Show Error Toast
    </button>
  )
}

describe('SnackbarProvider + useSnackbar', () => {
  it('renders a success toast when successSnackbar is called', async () => {
    render(
      <SnackbarProvider>
        <HarnessComponent />
      </SnackbarProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show Toast' }))

    const toast = await screen.findByText('Saved!')
    expect(toast).toBeInTheDocument()
  })

  it('renders an error toast when errorSnackbar is called', async () => {
    render(
      <SnackbarProvider>
        <ErrorHarnessComponent />
      </SnackbarProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show Error Toast' }))

    const toast = await screen.findByText('Something went wrong!')
    expect(toast).toBeInTheDocument()
  })

  it('renders the styleguide toast card: bottom-right, no richColors, no close button', async () => {
    render(
      <SnackbarProvider>
        <HarnessComponent />
      </SnackbarProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show Toast' }))
    await screen.findByText('Saved!')

    const toast = document.querySelector<HTMLElement>('[data-sonner-toast]')
    expect(toast?.getAttribute('data-rich-colors')).not.toBe('true')
    expect(toast?.getAttribute('data-y-position')).toBe('bottom')
    expect(toast?.getAttribute('data-x-position')).toBe('right')
    expect(toast?.querySelector('[data-close-button]')).toBeNull()
  })

  it('renders an optional description under the title', async () => {
    const DescriptionHarness = () => {
      const { successSnackbar } = useSnackbar()
      return (
        <button
          onClick={() =>
            successSnackbar('List deleted', {
              description: 'Males 50+ has been deleted.',
            })
          }
        >
          Show Toast
        </button>
      )
    }
    render(
      <SnackbarProvider>
        <DescriptionHarness />
      </SnackbarProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show Toast' }))

    expect(await screen.findByText('List deleted')).toBeInTheDocument()
    expect(screen.getByText('Males 50+ has been deleted.')).toBeInTheDocument()
  })

  it('throws when useSnackbar is used outside a SnackbarProvider', () => {
    const ThrowingComponent = () => {
      useSnackbar()
      return null
    }

    expect(() => render(<ThrowingComponent />)).toThrow(
      /within a SnackbarProvider/,
    )
  })

  it('offsets the toaster above the CRM assistant bar on /dashboard/contacts', async () => {
    mockPathname = '/dashboard/contacts'
    render(
      <SnackbarProvider>
        <HarnessComponent />
      </SnackbarProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show Toast' }))
    await screen.findByText('Saved!')

    const toaster = document.querySelector<HTMLElement>('[data-sonner-toaster]')
    expect(toaster?.style.getPropertyValue('--offset-bottom')).toBe('6rem')
    expect(toaster?.style.getPropertyValue('--mobile-offset-bottom')).toBe(
      '6rem',
    )
  })

  it('offsets the toaster on the other footer-chat-bar routes', async () => {
    mockPathname = '/dashboard/chief-of-staff'
    render(
      <SnackbarProvider>
        <HarnessComponent />
      </SnackbarProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show Toast' }))
    await screen.findByText('Saved!')

    const toaster = document.querySelector<HTMLElement>('[data-sonner-toaster]')
    expect(toaster?.style.getPropertyValue('--offset-bottom')).toBe('6rem')
    expect(toaster?.style.getPropertyValue('--mobile-offset-bottom')).toBe(
      '6rem',
    )
  })

  it('leaves the default toaster offset on non-CRM pages', async () => {
    mockPathname = '/dashboard'
    render(
      <SnackbarProvider>
        <HarnessComponent />
      </SnackbarProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Show Toast' }))
    await screen.findByText('Saved!')

    const toaster = document.querySelector<HTMLElement>('[data-sonner-toaster]')
    expect(toaster?.style.getPropertyValue('--offset-bottom')).not.toBe('6rem')
    expect(toaster?.style.getPropertyValue('--mobile-offset-bottom')).not.toBe(
      '6rem',
    )
  })
})
