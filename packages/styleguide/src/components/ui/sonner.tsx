import { useTheme } from 'next-themes'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

const Toaster = ({ ...props }: ToasterProps) => {
  // Default resolvedTheme to 'light': next-themes returns it undefined on SSR
  // and the first client render, which would otherwise flash light tokens on a
  // dark page until hydration resolves the actual theme.
  const { theme = 'system', resolvedTheme = 'light' } = useTheme()

  return (
    <Sonner
      data-slot="sonner"
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      style={
        {
          // Sonner portals toasts to <body>, outside the [data-slot] scope
          // where the styleguide --popover/--border tokens are defined — so a
          // bare var(--popover) resolved to empty and the toast rendered
          // transparent. The --color-* tokens have opaque light-mode fallbacks,
          // but they're Tailwind @property vars with inherits:false, so in the
          // portal they pin to their light initial regardless of theme (white
          // even on a dark page). Branch on `resolvedTheme` (theme is 'system'
          // by default) to the root-level --tw-neutral-* tokens for dark.
          '--normal-bg':
            resolvedTheme === 'dark'
              ? 'var(--tw-neutral-800)'
              : 'var(--color-popover)',
          '--normal-text':
            resolvedTheme === 'dark'
              ? 'var(--tw-neutral-50)'
              : 'var(--color-popover-foreground)',
          '--normal-border':
            resolvedTheme === 'dark'
              ? 'var(--tw-neutral-600)'
              : 'var(--color-border)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
export { toast } from 'sonner'
