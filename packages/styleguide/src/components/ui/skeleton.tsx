import { cn } from '@styleguide/lib/utils'

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
