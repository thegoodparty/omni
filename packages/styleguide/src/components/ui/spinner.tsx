import { cn } from '@styleguide/lib/utils'
import { LoaderCircleIcon } from './icons'

// The one canonical loading indicator for waiting states across the app.
// A lucide LoaderCircle icon rotating on its own axis, primary color,
// fixed size-6. Renders inline; wrap in a flex/centering container for
// full-viewport or section-level layouts.
//
// Use this for any "we are waiting" moment — feature-flag guards, route
// streaming boundaries, in-flight fetches, exit transitions. Do not
// reintroduce full-screen branded loaders; a plain spinner is the shared
// vocabulary the app agreed on. Size is deliberately fixed so every
// waiting state reads the same weight across surfaces.
export const Spinner = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-slot="spinner"
    role="status"
    aria-label="Loading"
    className={cn('inline-flex text-primary', className)}
    {...props}
  >
    <LoaderCircleIcon className="size-6 animate-spin" />
  </div>
)
