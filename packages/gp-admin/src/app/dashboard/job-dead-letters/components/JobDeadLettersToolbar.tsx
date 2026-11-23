'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Box, Flex, Select, Text } from '@radix-ui/themes'
import { SEARCH_PARAMS } from '../types'

// Radix's Select treats an empty string as "no value", so the unfiltered
// option needs a value of its own.
const ALL_QUEUES = '__all__'

interface JobDeadLettersToolbarProps {
  sourceQueue?: string
  queues: string[]
}

export function JobDeadLettersToolbar({
  sourceQueue,
  queues,
}: JobDeadLettersToolbarProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Emptying a queue's dead letters drops it from the options while it is
  // still the active filter, and a Radix Select with a value it has no item
  // for renders blank. Keeping it listed leaves the filter visible and
  // clearable instead of showing an empty trigger.
  const options =
    sourceQueue && !queues.includes(sourceQueue)
      ? [sourceQueue, ...queues]
      : queues

  // Filtering is the selection itself: a staff member picks a queue and the
  // list is already that queue. The old text field plus Apply button made two
  // steps of one, and landing back on page 4 of a now-shorter list was the
  // common failure.
  const chooseQueue = (value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value === ALL_QUEUES) {
      params.delete(SEARCH_PARAMS.SOURCE_QUEUE)
    } else {
      params.set(SEARCH_PARAMS.SOURCE_QUEUE, value)
    }
    params.delete(SEARCH_PARAMS.PAGE)
    const queryString = params.toString()
    router.push(
      `/dashboard/job-dead-letters${queryString ? `?${queryString}` : ''}`
    )
  }

  return (
    <Box p="4" className="border border-[var(--gray-5)] rounded-lg">
      <Flex gap="2" direction="column">
        <Text as="label" size="2" weight="medium" htmlFor="source-queue">
          Source queue
        </Text>
        <Select.Root
          value={sourceQueue ?? ALL_QUEUES}
          onValueChange={chooseQueue}
        >
          <Select.Trigger
            id="source-queue"
            placeholder="All queues"
            style={{ width: '320px' }}
          />
          <Select.Content position="popper">
            <Select.Item value={ALL_QUEUES}>All queues</Select.Item>
            {options.map((queue) => (
              <Select.Item key={queue} value={queue}>
                {queue}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Flex>
    </Box>
  )
}
