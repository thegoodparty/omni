'use client'
import { createContext, useContext, useCallback, ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { Toaster, toast } from '@styleguide'

interface SnackbarState {
  autoHideDuration?: number
}

// The CRM contacts page pins AssistantBar.tsx to the bottom of the viewport
// (~5rem tall including its padding); a bottom-center toast with no offset
// lands on top of it. 6rem clears the bar on both mobile and desktop, where
// only the horizontal placement (not the height) of the bar differs.
const CRM_CONTACTS_PATH_PREFIX = '/dashboard/contacts'
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
  const isCrmContactsPage =
    pathname?.startsWith(CRM_CONTACTS_PATH_PREFIX) ?? false

  const displaySnackbar = useCallback(
    (message: string, isError = false, optionalProps: SnackbarState = {}) => {
      const options = { duration: optionalProps.autoHideDuration ?? 4000 }
      if (isError) {
        toast.error(message, options)
      } else {
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
        position="bottom-center"
        richColors
        closeButton
        offset={isCrmContactsPage ? CRM_ASSISTANT_BAR_CLEARANCE : undefined}
        mobileOffset={
          isCrmContactsPage ? CRM_ASSISTANT_BAR_CLEARANCE : undefined
        }
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
