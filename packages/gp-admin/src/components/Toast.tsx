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
        <ToastPrimitive.Root open={open} onOpenChange={setOpen}>
          {variant === 'error' ? (
            <HiExclamationCircle color="var(--red-9)" />
          ) : (
            <HiCheck />
          )}
          <ToastPrimitive.Description>{message}</ToastPrimitive.Description>
          <ToastPrimitive.Close aria-label="Close">
            <HiX />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
        <ToastPrimitive.Viewport />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  )
}
