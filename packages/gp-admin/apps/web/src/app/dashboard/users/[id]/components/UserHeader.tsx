'use client'

import { Flex, Heading, Text, Avatar, Badge, Box } from '@radix-ui/themes'
import { useUser } from '../UserProvider'

export function UserHeader() {
  const user = useUser()
  const { data, details } = user

  return (
    <Flex gap="5" align="start">
      <Avatar
        size="7"
        src={data.image}
        fallback={details.firstName?.[0] ?? 'U'}
        radius="medium"
      />
      <Box>
        <Flex gap="3" align="center" mb="1">
          <Heading size="7">{data.name}</Heading>
          {user.isPro && (
            <Badge color="violet" size="2">
              Pro
            </Badge>
          )}
          {user.didWin && (
            <Badge color="green" size="2">
              Winner
            </Badge>
          )}
        </Flex>
        <Text as="p" size="3" color="gray" mb="2">
          {details.occupation}
        </Text>
        <Flex gap="2" wrap="wrap">
          <Badge color={user.isActive ? 'green' : 'gray'} variant="soft">
            {user.isActive ? 'Active' : 'Inactive'}
          </Badge>
          <Badge color={user.isVerified ? 'blue' : 'orange'} variant="soft">
            {user.isVerified ? 'Verified' : 'Unverified'}
          </Badge>
          {user.isDemo && (
            <Badge color="amber" variant="soft">
              Demo
            </Badge>
          )}
          <Badge color="gray" variant="soft">
            {details.party}
          </Badge>
          <Badge color="iris" variant="soft">
            {data.launchStatus}
          </Badge>
        </Flex>
      </Box>
    </Flex>
  )
}
