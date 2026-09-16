import { Container, Flex, Heading, Skeleton, Text } from '@radix-ui/themes'

// Mirrors the queue's real layout (tabs, toolbar, table rows) so the page
// doesn't reflow when data lands — the chrome is already where it will be.
export default function Loading() {
  return (
    <Container size="4">
      <Heading size="6" mb="1">
        SMS outreach
      </Heading>
      <Text color="gray" size="2">
        Scheduled text campaigns awaiting the one human approval. Approving
        books the vendor&apos;s canvassers; nothing sends without it.
      </Text>
      <Flex justify="between" align="center" mt="4" mb="3">
        <Flex gap="4">
          <Skeleton width="110px" height="28px" />
          <Skeleton width="90px" height="28px" />
          <Skeleton width="70px" height="28px" />
          <Skeleton width="80px" height="28px" />
        </Flex>
        <Flex gap="3" align="center">
          <Skeleton width="110px" height="32px" />
          <Skeleton width="220px" height="32px" />
        </Flex>
      </Flex>
      <Skeleton width="100%" height="40px" />
      <Flex direction="column" gap="2" mt="2">
        {[92, 100, 96, 100, 88, 100, 94, 98].map((width, row) => (
          <Skeleton key={row} width={`${width}%`} height="44px" />
        ))}
      </Flex>
    </Container>
  )
}
