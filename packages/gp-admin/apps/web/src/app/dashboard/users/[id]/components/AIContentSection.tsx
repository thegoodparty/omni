'use client'

import { useState } from 'react'
import DOMPurify from 'isomorphic-dompurify'
import { Box, Text, Badge, Flex, Button, ScrollArea } from '@radix-ui/themes'
import { formatDate } from '@/lib/utils/date'
import { formatKeyAsLabel } from '@/lib/utils/string'
import { useUser } from '../UserProvider'
import { InfoCard } from './InfoCard'
import type { AIContentItem } from '../types'

function isAIContentItem(
  value: AIContentItem | Record<string, unknown>
): value is AIContentItem {
  return typeof value === 'object' && value !== null && 'content' in value
}

export function AIContentSection() {
  const user = useUser()
  const [selectedContent, setSelectedContent] = useState<string | null>(null)
  const aiContent = user.aiContent
  if (!aiContent) return null

  const entries = Object.entries(aiContent).filter(
    ([, value]) => isAIContentItem(value) && value.content
  ) as [string, AIContentItem][]

  if (entries.length === 0) return null

  const selectedValue = selectedContent
    ? aiContent[selectedContent]
    : entries[0]?.[1]
  const selected = isAIContentItem(selectedValue) ? selectedValue : null
  const selectedKey = selectedContent || entries[0]?.[0]

  return (
    <InfoCard title={`AI Generated Content (${entries.length} items)`}>
      <Flex gap="4" direction={{ initial: 'column', md: 'row' }}>
        <Box style={{ minWidth: '200px' }}>
          <ScrollArea style={{ maxHeight: '400px' }}>
            <Flex direction="column" gap="1">
              {entries.map(([key, value]) => (
                <Button
                  key={key}
                  variant={selectedKey === key ? 'solid' : 'ghost'}
                  size="1"
                  onClick={() => setSelectedContent(key)}
                  style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                >
                  <Text size="1" truncate>
                    {value.name || formatKeyAsLabel(key)}
                  </Text>
                </Button>
              ))}
            </Flex>
          </ScrollArea>
        </Box>

        <Box style={{ flex: 1 }}>
          {selected && (
            <Box>
              <Flex gap="2" align="center" mb="3">
                <Text size="3" weight="bold">
                  {selected.name || formatKeyAsLabel(selectedKey)}
                </Text>
                {selected.updatedAt && (
                  <Badge color="gray" variant="soft" size="1">
                    Updated: {formatDate(selected.updatedAt)}
                  </Badge>
                )}
              </Flex>
              <ScrollArea style={{ maxHeight: '350px' }}>
                <Box
                  p="3"
                  className="bg-[var(--gray-2)] rounded-md"
                  style={{ fontSize: '13px', lineHeight: 1.6 }}
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(selected.content || ''),
                  }}
                />
              </ScrollArea>
            </Box>
          )}
        </Box>
      </Flex>
    </InfoCard>
  )
}
