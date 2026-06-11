'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Box,
  Button,
  Flex,
  SegmentedControl,
  Text,
  TextField,
} from '@radix-ui/themes'
import { HiSearch } from 'react-icons/hi'
import {
  DATE_RANGES,
  REVIEW_STATUSES,
  SEARCH_PARAMS,
  type DateRange,
  type ReviewStatus,
} from '../types'

interface BriefingsToolbarProps {
  query: string
  dateRange: DateRange
  reviewStatus?: ReviewStatus
}

export function BriefingsToolbar({
  query,
  dateRange,
  reviewStatus,
}: BriefingsToolbarProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [queryInput, setQueryInput] = useState(query)

  function pushParams(updates: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined || value === '') {
        params.delete(key)
      } else {
        params.set(key, value)
      }
    }
    params.delete(SEARCH_PARAMS.PAGE)
    const queryString = params.toString()
    router.push(`/dashboard/briefings${queryString ? `?${queryString}` : ''}`)
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    pushParams({ [SEARCH_PARAMS.QUERY]: queryInput })
  }

  function handleDateRangeChange(value: string) {
    pushParams({
      [SEARCH_PARAMS.DATE_RANGE]: value === 'All time' ? undefined : value,
    })
  }

  return (
    <Box asChild p="4" className="border border-[var(--gray-5)] rounded-lg">
      <form autoComplete="off" onSubmit={handleSubmit}>
        <Flex direction="column" gap="4">
          <Flex align="end" gap="2">
            <Box flexGrow="1">
              <Text as="label" size="2" weight="medium" mb="2">
                Search
              </Text>
              <TextField.Root
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                placeholder="Search by user, email, or office"
              >
                <TextField.Slot>
                  <HiSearch className="w-4 h-4" />
                </TextField.Slot>
              </TextField.Root>
            </Box>
            <Button type="submit">Search</Button>
          </Flex>

          <Box>
            <Text as="label" size="2" weight="medium" mb="2" mr="2">
              Date range
            </Text>
            <SegmentedControl.Root
              value={dateRange}
              onValueChange={handleDateRangeChange}
            >
              {DATE_RANGES.map((range) => (
                <SegmentedControl.Item key={range} value={range}>
                  {range}
                </SegmentedControl.Item>
              ))}
            </SegmentedControl.Root>
          </Box>

          <Box>
            <Text as="label" size="2" weight="medium" mb="2" mr="2">
              Review status
            </Text>
            <SegmentedControl.Root
              value={reviewStatus ?? 'all'}
              onValueChange={(value) =>
                pushParams({
                  [SEARCH_PARAMS.REVIEW_STATUS]:
                    value === 'all' ? undefined : value,
                })
              }
            >
              <SegmentedControl.Item value="all">All</SegmentedControl.Item>
              {REVIEW_STATUSES.map((status) => (
                <SegmentedControl.Item key={status} value={status}>
                  {status[0].toUpperCase() + status.slice(1)}
                </SegmentedControl.Item>
              ))}
            </SegmentedControl.Root>
          </Box>
        </Flex>
      </form>
    </Box>
  )
}
