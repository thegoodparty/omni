import * as React from 'react'
import { cva } from 'class-variance-authority'
import { ChevronLeftIcon, ChevronRightIcon, MoreHorizontalIcon } from './icons'

import { cn } from '../../lib/utils'

function Pagination({ className, ...props }: React.ComponentProps<'nav'>) {
  return (
    <nav
      role="navigation"
      aria-label="pagination"
      data-slot="pagination"
      className={cn('mx-auto flex w-full justify-center', className)}
      {...props}
    />
  )
}

function PaginationContent({
  className,
  ...props
}: React.ComponentProps<'ul'>) {
  return (
    <ul
      data-slot="pagination-content"
      className={cn(
        'flex flex-row items-center gap-1 !m-0 !p-0 !list-none',
        className,
      )}
      {...props}
    />
  )
}

function PaginationItem({ className, ...props }: React.ComponentProps<'li'>) {
  return (
    <li
      data-slot="pagination-item"
      className={cn('!mb-0', className)}
      {...props}
    />
  )
}

const paginationLinkVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent text-sm font-medium text-foreground no-underline transition-colors outline-none hover:bg-base-accent focus-visible:ring-primary-focus focus-visible:ring-[3px] aria-disabled:pointer-events-none aria-disabled:opacity-50',
  {
    variants: {
      isActive: {
        true: 'border-components-input-border hover:bg-muted',
        false: '',
      },
      size: {
        small: 'size-8',
        medium: 'size-10',
        large: 'size-12',
      },
    },
    defaultVariants: {
      isActive: false,
      size: 'medium',
    },
  },
)

type PaginationLinkProps = {
  isActive?: boolean
  size?: 'small' | 'medium' | 'large'
} & React.ComponentProps<'a'>

function PaginationLink({
  className,
  isActive,
  size = 'medium',
  ...props
}: PaginationLinkProps) {
  return (
    <a
      aria-current={isActive ? 'page' : undefined}
      data-slot="pagination-link"
      data-active={isActive}
      className={cn(paginationLinkVariants({ isActive, size }), className)}
      {...props}
    />
  )
}

function PaginationPrevious({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>) {
  return (
    <PaginationLink
      aria-label="Go to previous page"
      className={cn('w-auto gap-1 px-2.5 sm:pl-2.5', className)}
      {...props}
    >
      <ChevronLeftIcon className="size-4" />
      <span className="hidden sm:block">Previous</span>
    </PaginationLink>
  )
}

function PaginationNext({
  className,
  ...props
}: React.ComponentProps<typeof PaginationLink>) {
  return (
    <PaginationLink
      aria-label="Go to next page"
      className={cn('w-auto gap-1 px-2.5 sm:pr-2.5', className)}
      {...props}
    >
      <span className="hidden sm:block">Next</span>
      <ChevronRightIcon className="size-4" />
    </PaginationLink>
  )
}

const ellipsisSizeMap: Record<'small' | 'medium' | 'large', string> = {
  small: 'size-8',
  medium: 'size-10',
  large: 'size-12',
}

const ellipsisIconSizeMap: Record<'small' | 'medium' | 'large', string> = {
  small: 'size-3',
  medium: 'size-4',
  large: 'size-5',
}

type PaginationEllipsisProps = {
  size?: 'small' | 'medium' | 'large'
} & React.ComponentProps<'span'>

function PaginationEllipsis({
  className,
  size = 'medium',
  ...props
}: PaginationEllipsisProps) {
  return (
    <span
      aria-hidden
      data-slot="pagination-ellipsis"
      className={cn(
        'flex items-center justify-center text-foreground',
        ellipsisSizeMap[size],
        className,
      )}
      {...props}
    >
      <MoreHorizontalIcon className={ellipsisIconSizeMap[size]} />
      <span className="sr-only">More pages</span>
    </span>
  )
}

export {
  Pagination,
  PaginationContent,
  PaginationLink,
  PaginationItem,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
}
