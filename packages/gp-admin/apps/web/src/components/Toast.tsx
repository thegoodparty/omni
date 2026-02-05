'use client'

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react'
import * as ToastPrimitive from '@radix-ui/react-toast'
import { HiCheck, HiX } from 'react-icons/hi'

const TOAST_DURATION = 3000

interface ToastContextValue {
  showToast: (message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}

interface ToastProviderProps {
  children: ReactNode
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')

  const showToast = useCallback((msg: string) => {
    setMessage(msg)
    setOpen(true)
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      <ToastPrimitive.Provider swipeDirection="right" duration={TOAST_DURATION}>
        {children}
        <ToastPrimitive.Root
          open={open}
          onOpenChange={setOpen}
          className="
            bg-[var(--green-3)] border border-[var(--green-6)] rounded-md shadow-lg
            p-4 flex items-center gap-3
            data-[state=open]:animate-in data-[state=open]:slide-in-from-top-2
            data-[state=closed]:animate-out data-[state=closed]:fade-out
            data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]
            data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-transform
            data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)]
          "
        >
          <HiCheck className="w-5 h-5 text-[var(--green-11)]" />
          <ToastPrimitive.Description className="text-sm text-[var(--green-12)]">
            {message}
          </ToastPrimitive.Description>
          <ToastPrimitive.Close
            className="ml-auto text-[var(--green-11)] hover:text-[var(--green-12)]"
            aria-label="Close"
          >
            <HiX className="w-4 h-4" />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
        <ToastPrimitive.Viewport className="fixed top-4 right-4 z-50 w-80" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  )
}
