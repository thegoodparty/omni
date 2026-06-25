const GRADIENT_STYLE = {
  background:
    'conic-gradient(from var(--gradient-angle), var(--ai-gradient-from), var(--ai-gradient-to), var(--ai-gradient-from))',
}

interface Props {
  /** Outer shape. `3xl` for the expanded multiline composer, `full` otherwise. */
  rounded?: 'full' | '3xl'
  /** Extra classes on the gradient-border wrapper (sizing, layout). */
  className?: string
  /** Extra classes on the inner surface (alignment, focus ring). */
  innerClassName?: string
  children: React.ReactNode
}

/**
 * The animated gradient-border pill shared by the footer bar (AiChatBar) and
 * the drawer composer (AiChatBody). Renders the conic-gradient border wrapper
 * around a `bg-card` surface; callers supply the inner controls as children.
 */
export default function ChatPill({
  rounded = 'full',
  className,
  innerClassName,
  children,
}: Props): React.JSX.Element {
  const radius = rounded === '3xl' ? 'rounded-3xl' : 'rounded-full'
  return (
    <div
      className={`relative p-[1.5px] animate-spin-gradient ${radius}${className ? ` ${className}` : ''}`}
      style={GRADIENT_STYLE}
    >
      <div
        className={`flex min-h-12 w-full gap-1 bg-card py-0.5 pl-1.5 pr-1 ${radius}${innerClassName ? ` ${innerClassName}` : ''}`}
      >
        {children}
      </div>
    </div>
  )
}
