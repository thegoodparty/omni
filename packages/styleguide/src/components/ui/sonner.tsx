import { useTheme } from 'next-themes'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { cn } from '@styleguide/lib/utils'

/**
 * SnackbarProvider already mounts it in gp-webapp. Call useSnackbar() instead of
 * toast() or a second Toaster.
 *
 * @summary Use for a brief, low-stakes confirmation that fades away. Never for
 * form errors or the end of a flow; show errors by the field and a success view.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  // Default resolvedTheme to 'light': next-themes returns it undefined on SSR
  // and the first client render, which would otherwise flash light tokens on a
  // dark page until hydration resolves the actual theme.
  const { resolvedTheme = 'light' } = useTheme()

  return (
    <Sonner
      data-slot="sonner"
      // Sonner's theme must follow the same resolvedTheme as the colors below.
      // Left on 'system', it went dark on an OS in dark mode while the card
      // stayed light, painting the description near-white on white.
      theme={resolvedTheme as ToasterProps['theme']}
      // Sonner keeps the action button on the text's row, which squeezes long
      // copy into a narrow column; the min width makes the button wrap below.
      // The description color needs ! to beat Sonner's own hardcoded grey.
      className={cn(
        'toaster group [&_[data-sonner-toast]]:flex-wrap [&_[data-content]]:min-w-[70%] [&_[data-content]]:flex-1',
        resolvedTheme !== 'dark' &&
          '[&_[data-description]]:!text-muted-foreground',
      )}
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
