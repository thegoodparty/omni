'use client'
import { createContext, useContext, useCallback, ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { Toaster, toast } from '@styleguide'

interface SnackbarState {
  autoHideDuration?: number
  description?: string
}

// These routes pin a FooterChatBar-style bar (fixed inset-x-0 bottom-0,
// ~5rem tall including padding) to the bottom of the viewport; a
// bottom-anchored toast with no offset lands on top of it. 6rem clears the
// bar on both mobile and desktop, where only the horizontal placement
// (not the height) of the bar differs.
const FOOTER_CHAT_BAR_PATH_PREFIXES = [
  '/dashboard/contacts',
  '/dashboard/chief-of-staff',
  '/dashboard/campaign-manager',
  '/dashboard/community-issues',
  '/dashboard/ordinances',
]
const CRM_ASSISTANT_BAR_CLEARANCE = '6rem'

interface SnackbarContextValue {
  displaySnackbar: (
    message: string,
    isError?: boolean,
    optionalProps?: SnackbarState,
  ) => void
  errorSnackbar: (message: string, optionalProps?: SnackbarState) => void
  successSnackbar: (message: string, optionalProps?: SnackbarState) => void
}

const SnackbarContext = createContext<SnackbarContextValue | null>(null)

export const SnackbarProvider = ({ children }: { children: ReactNode }) => {
  const pathname = usePathname()
  const hasFooterChatBar = FOOTER_CHAT_BAR_PATH_PREFIXES.some(
    (prefix) => pathname?.startsWith(prefix) ?? false,
  )

  const displaySnackbar = useCallback(
    (message: string, isError = false, optionalProps: SnackbarState = {}) => {
      const options = {
        duration: optionalProps.autoHideDuration ?? 4000,
        description: optionalProps.description,
      }
      if (isError) {
        toast.error(message, options)
      } else {
        // Success variant adds a check icon; the green accent is applied via
        // the Toaster's toastOptions below so the card stays neutral/opaque.
        toast.success(message, options)
      }
    },
    [],
  )

  const value: SnackbarContextValue = {
    displaySnackbar,
    errorSnackbar: (message, optionalProps) =>
      displaySnackbar(message, true, optionalProps),
    successSnackbar: (message, optionalProps) =>
      displaySnackbar(message, false, optionalProps),
  }

  return (
    <SnackbarContext.Provider value={value}>
      {children}
      <Toaster
        position="bottom-right"
        offset={hasFooterChatBar ? CRM_ASSISTANT_BAR_CLEARANCE : undefined}
        mobileOffset={
          hasFooterChatBar ? CRM_ASSISTANT_BAR_CLEARANCE : undefined
        }
        toastOptions={{
          classNames: {
            // Make success confirmations read as clearly positive: a green
            // left accent + tinted check icon, keeping the card neutral.
            success: 'border-l-2 border-l-success [&_[data-icon]]:text-success',
          },
        }}
      />
    </SnackbarContext.Provider>
  )
}

export const useSnackbar = (): SnackbarContextValue => {
  const context = useContext(SnackbarContext)
  if (!context) {
    throw new Error('useSnackbar must be used within a SnackbarProvider')
  }
  return context
}

const Snackbar = () => null
export default Snackbar
