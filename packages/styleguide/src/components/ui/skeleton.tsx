import { cn } from '@styleguide/lib/utils'

/**
 * Size each one with className to match the content it stands in for.
 *
 * @summary Use for gray placeholder shapes that hold the layout while content
 * loads. For a wait with no layout to preview, use Spinner.
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('bg-inactive animate-pulse rounded-md', className)}
      {...props}
    />
  )
}

export { Skeleton }
