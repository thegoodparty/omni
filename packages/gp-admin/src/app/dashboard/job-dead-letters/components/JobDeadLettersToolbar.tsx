'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Box, Button, Flex, Text, TextField } from '@radix-ui/themes'
import { HiX } from 'react-icons/hi'
import { SEARCH_PARAMS } from '../types'

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
  const [sourceQueueInput, setSourceQueueInput] = useState(sourceQueue ?? '')

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
    <Box asChild p="4" className="border border-[var(--gray-5)] rounded-lg">
      <form
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault()
          pushParams({
            [SEARCH_PARAMS.SOURCE_QUEUE]: sourceQueueInput.trim() || undefined,
          })
        }}
      >
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
            <TextField.Root
              id="source-queue"
              placeholder="e.g. doorKnockingCanvassingTotals"
              list="source-queue-options"
              value={sourceQueueInput}
              onChange={(event) => setSourceQueueInput(event.target.value)}
            />
            <datalist id="source-queue-options">
              {queues.map((queue) => (
                <option key={queue} value={queue} />
              ))}
            </datalist>
          </Box>
          <Button type="submit">Apply filter</Button>
          {sourceQueue && (
            <Button
              type="button"
              variant="soft"
              color="gray"
              onClick={() => {
                setSourceQueueInput('')
                pushParams({ [SEARCH_PARAMS.SOURCE_QUEUE]: undefined })
              }}
            >
              <HiX className="w-4 h-4" />
              Clear
            </Button>
          )}
        </Flex>
      </form>
    </Box>
  )
}
