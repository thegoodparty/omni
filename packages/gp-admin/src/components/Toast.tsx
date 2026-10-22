'use client'

import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from 'react'
import * as ToastPrimitive from '@radix-ui/react-toast'
import { HiCheck, HiExclamationCircle, HiX } from 'react-icons/hi'

const TOAST_DURATION = 3000

export type ToastVariant = 'success' | 'error'

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant) => void
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
  const [variant, setVariant] = useState<ToastVariant>('success')

  const showToast = useCallback(
    (msg: string, msgVariant: ToastVariant = 'success') => {
      setMessage(msg)
      setVariant(msgVariant)
      setOpen(true)
    },
    []
  )

  return (
    <ToastContext.Provider value={{ showToast }}>
      <ToastPrimitive.Provider swipeDirection="right" duration={TOAST_DURATION}>
        {children}
        <ToastPrimitive.Root
          open={open}
          onOpenChange={setOpen}
          className="flex items-center gap-3 rounded-[var(--radius-3)] bg-[var(--color-panel-solid)] p-3 text-sm text-[var(--gray-12)] shadow-[var(--shadow-5)]"
        >
          {variant === 'error' ? (
            <HiExclamationCircle color="var(--red-9)" className="shrink-0" />
          ) : (
            <HiCheck className="shrink-0" />
          )}
          <ToastPrimitive.Description className="flex-1">
            {message}
          </ToastPrimitive.Description>
          <ToastPrimitive.Close aria-label="Close" className="shrink-0">
            <HiX />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
        {/* Fixed and above everything: Radix dialogs portal to the end of
            <body> with no z-index, so an in-flow viewport sits behind an
            open dialog's overlay (or below the fold) and nobody sees it. */}
        <ToastPrimitive.Viewport className="fixed right-4 bottom-4 z-[2147483647] m-0 flex w-96 max-w-[calc(100vw-2rem)] list-none flex-col gap-2 p-0 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  )
}
