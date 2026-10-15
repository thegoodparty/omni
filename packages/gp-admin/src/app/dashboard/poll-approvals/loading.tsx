import { Box, Container, Flex, Heading, Skeleton, Text } from '@radix-ui/themes'

export default function Loading() {
  return (
    <Container size="4">
      <Box>
        <Heading size="6" mb="1">
          Poll approvals
        </Heading>
        <Text color="gray" size="2">
          Paid polls and expansions wait here. Nothing sends until one admin
          approves it.
        </Text>
      </Box>
      <Flex gap="4" mt="4" mb="3">
        <Skeleton width="130px" height="28px" />
        <Skeleton width="100px" height="28px" />
        <Skeleton width="90px" height="28px" />
      </Flex>
      <Skeleton width="100%" height="40px" />
      <Flex direction="column" gap="2" mt="2">
        {[92, 100, 96, 100, 88].map((width, row) => (
          <Skeleton key={row} width={`${width}%`} height="44px" />
        ))}
      </Flex>
    </Container>
  )
}
