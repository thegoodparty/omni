import type { ReactElement, ReactNode } from 'react'
import {
  render,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react'
import { Theme } from '@radix-ui/themes'
import { ToastProvider } from '@/components/Toast'

const AllProviders = ({ children }: { children: ReactNode }) => (
  <Theme>
    <ToastProvider>{children}</ToastProvider>
  </Theme>
)

export const renderWithProviders = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
): RenderResult => render(ui, { wrapper: AllProviders, ...options })
