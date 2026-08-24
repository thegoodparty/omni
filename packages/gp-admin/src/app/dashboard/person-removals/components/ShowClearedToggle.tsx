'use client'

import { useRouter } from 'next/navigation'
import { Flex, Switch, Text } from '@radix-ui/themes'
import { INCLUDE_CLEARED_VALUE, SEARCH_PARAMS } from '../types'

interface ShowClearedToggleProps {
  includeCleared: boolean
}

export function ShowClearedToggle({ includeCleared }: ShowClearedToggleProps) {
  const router = useRouter()

  function handleChange(checked: boolean) {
    const query = checked
      ? `?${SEARCH_PARAMS.INCLUDE_CLEARED}=${INCLUDE_CLEARED_VALUE}`
      : ''
    router.push(`/dashboard/person-removals${query}`)
  }

  return (
    <Text as="label" size="2">
      <Flex gap="2" align="center">
        <Switch checked={includeCleared} onCheckedChange={handleChange} />
        Show restored profiles
      </Flex>
    </Text>
  )
}
