import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useArgs } from 'storybook/preview-api'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '../components/ui/pagination'

const meta: Meta<typeof Pagination> = {
  title: 'Components/Pagination',
  component: Pagination,
  tags: ['autodocs'],
}

export default meta

type Story = StoryObj<typeof Pagination>

type PlaygroundArgs = {
  totalPages: number
  currentPage: number
  size: 'small' | 'medium' | 'large'
}

const pageList = (total: number, current: number): (number | 'ellipsis')[] => {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }
  const result: (number | 'ellipsis')[] = []
  const left = Math.max(2, current - 1)
  const right = Math.min(total - 1, current + 1)
  result.push(1)
  if (left > 2) result.push('ellipsis')
  for (let p = left; p <= right; p++) result.push(p)
  if (right < total - 1) result.push('ellipsis')
  result.push(total)
  return result
}

export const Playground: StoryObj<PlaygroundArgs> = {
  args: {
    totalPages: 10,
    currentPage: 4,
    size: 'medium',
  },
  argTypes: {
    totalPages: { control: { type: 'number', min: 1, max: 50 } },
    currentPage: { control: { type: 'number', min: 1, max: 50 } },
    size: {
      control: { type: 'select' },
      options: ['small', 'medium', 'large'],
    },
  },
  render: () => {
    const [{ totalPages, currentPage, size }, updateArgs] =
      useArgs<PlaygroundArgs>()
    const pages = pageList(totalPages, currentPage)
    const goTo = (page: number) => (event: React.MouseEvent) => {
      event.preventDefault()
      updateArgs({ currentPage: Math.min(Math.max(page, 1), totalPages) })
    }
    return (
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              href="#"
              size={size}
              onClick={goTo(currentPage - 1)}
              aria-disabled={currentPage === 1}
            />
          </PaginationItem>
          {pages.map((p, i) =>
            p === 'ellipsis' ? (
              <PaginationItem key={`ellipsis-${i}`}>
                <PaginationEllipsis size={size} />
              </PaginationItem>
            ) : (
              <PaginationItem key={p}>
                <PaginationLink
                  href="#"
                  size={size}
                  isActive={p === currentPage}
                  onClick={goTo(p)}
                >
                  {p}
                </PaginationLink>
              </PaginationItem>
            ),
          )}
          <PaginationItem>
            <PaginationNext
              href="#"
              size={size}
              onClick={goTo(currentPage + 1)}
              aria-disabled={currentPage === totalPages}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    )
  },
}

export const Sizes: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <div className="flex flex-col gap-6">
      {(['small', 'medium', 'large'] as const).map((size) => (
        <div key={size} className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground capitalize">
            {size}
          </span>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious href="#" size={size} />
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#" size={size}>
                  1
                </PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#" size={size} isActive>
                  2
                </PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationEllipsis size={size} />
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#" size={size}>
                  10
                </PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationNext href="#" size={size} />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      ))}
    </div>
  ),
}

export const WithEllipsis: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Pagination>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious href="#" />
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#">1</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationEllipsis />
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#">10</PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationNext href="#" />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  ),
}

export const States: Story = {
  parameters: { controls: { disable: true } },
  render: () => (
    <Pagination>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious href="#" aria-disabled={true} />
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#" aria-disabled={true}>
            1
          </PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#" isActive aria-disabled={true}>
            2
          </PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationNext href="#" aria-disabled={true} />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  ),
}
