'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Box, Flex, Select, Text } from '@radix-ui/themes'
import { SEARCH_PARAMS } from '../types'

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

  const pushParams = (updates: Record<string, string | undefined>) => {
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
    router.push(
      `/dashboard/job-dead-letters${queryString ? `?${queryString}` : ''}`
    )
  }

  return (
    <Box p="4" className="border border-[var(--gray-5)] rounded-lg">
      <Flex gap="3" align="end" wrap="wrap">
        <Box>
          <Text
            as="label"
            size="2"
            weight="medium"
            mb="1"
            htmlFor="source-queue"
          >
            Source queue
          </Text>
          <Box>
            <Select.Root
              value={sourceQueue ?? ALL_QUEUES}
              onValueChange={(value) =>
                pushParams({
                  [SEARCH_PARAMS.SOURCE_QUEUE]:
                    value === ALL_QUEUES ? undefined : value,
                })
              }
            >
              <Select.Trigger id="source-queue" className="min-w-64" />
              <Select.Content>
                <Select.Item value={ALL_QUEUES}>All queues</Select.Item>
                {queues.map((queue) => (
                  <Select.Item key={queue} value={queue}>
                    {queue}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Box>
        </Box>
      </Flex>
    </Box>
  )
}
