'use client'

import type { CSSProperties } from 'react'
import { Toaster } from '@goodparty_org/styleguide'

// Styled wrapper over the DS Toaster (sonner). The styleguide color tokens
// (--popover, --foreground, …) live inside the [data-slot] scope, but sonner
// renders toasts in a body-level portal where those resolve to transparent —
// which is why the default toast looked see-through. We repoint sonner's own
// theming vars at the @theme --color-* aliases (they carry an opaque fallback
// at :root) and lift the corner radius to our 16px token. Everything is a
// design token; nothing here is a hardcoded colour, radius, or font.
export const AppToaster = () => (
  <Toaster
    style={
      {
        '--normal-bg': 'var(--color-popover)',
        '--normal-text': 'var(--color-foreground)',
        '--normal-border': 'var(--color-border)',
        '--border-radius': 'var(--border-radius-lg)',
      } as CSSProperties
    }
    toastOptions={{
      classNames: {
        toast: 'font-opensans shadow-lg',
        title: '!text-foreground font-semibold',
        description: '!text-muted-foreground',
      },
    }}
  />
)
