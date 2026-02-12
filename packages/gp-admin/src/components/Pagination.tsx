'use client'

import { Select, IconButton, Flex, Text } from '@radix-ui/themes'
import { HiChevronLeft, HiChevronRight } from 'react-icons/hi'
import type { PaginationMeta } from '@goodparty_org/sdk'
import {
  PER_PAGE_OPTIONS,
  PerPageOption,
  isPerPageOption,
} from '../app/dashboard/users/types'

interface PaginationProps {
  meta: PaginationMeta
  currentPage: number
  perPage: PerPageOption
  onPageChange: (page: number) => void
  onPerPageChange: (perPage: PerPageOption) => void
}

export function Pagination({
  meta,
  currentPage,
  perPage,
  onPageChange,
  onPerPageChange,
}: PaginationProps) {
  const { total } = meta
  const totalPages = Math.ceil(total / perPage)
  const isFirstPage = currentPage <= 1
  const isLastPage = currentPage >= totalPages

  const rangeStart = total === 0 ? 0 : (currentPage - 1) * perPage + 1
  const rangeEnd = Math.min(currentPage * perPage, total)

  const handlePreviousPage = () => {
    if (!isFirstPage) {
      onPageChange(currentPage - 1)
    }
  }

  const handleNextPage = () => {
    if (!isLastPage) {
      onPageChange(currentPage + 1)
    }
  }

  const handlePerPageChange = (value: string) => {
    const parsed = Number(value)
    if (isPerPageOption(parsed)) {
      onPerPageChange(parsed)
    }
  }

  if (total === 0) {
    return null
  }

  return (
    <Flex align="center" justify="between" py="4">
      <Flex align="center" gap="2">
        <Text size="2" color="gray">
          Rows per page:
        </Text>
        <Select.Root
          value={String(perPage)}
          onValueChange={handlePerPageChange}
        >
          <Select.Trigger aria-label="Results per page" />
          <Select.Content>
            {PER_PAGE_OPTIONS.map((option) => (
              <Select.Item key={option} value={String(option)}>
                {option}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Flex>

      <Flex align="center" gap="3">
        <Text size="2" color="gray">
          {rangeStart}–{rangeEnd} of {total}
        </Text>
        <Flex gap="1">
          <IconButton
            variant="soft"
            color="gray"
            disabled={isFirstPage}
            onClick={handlePreviousPage}
            aria-label="Previous page"
            className="cursor-pointer"
          >
            <HiChevronLeft className="w-4 h-4" />
          </IconButton>
          <IconButton
            variant="soft"
            color="gray"
            disabled={isLastPage}
            onClick={handleNextPage}
            aria-label="Next page"
            className="cursor-pointer"
          >
            <HiChevronRight className="w-4 h-4" />
          </IconButton>
        </Flex>
      </Flex>
    </Flex>
  )
}
