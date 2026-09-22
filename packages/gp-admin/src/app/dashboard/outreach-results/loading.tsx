import { Container, Flex, Heading, Skeleton, Text } from '@radix-ui/themes'

// Mirrors the inbox layout (badges, search, table) so the page does not
// reflow when the queue lands.
export default function Loading() {
  return (
    <Container size="4">
      <Heading size="6" mb="1">
        Outreach results
      </Heading>
      <Text color="gray" size="2">
        Every send whose replies have not come back yet.
      </Text>
      <Flex justify="between" align="center" mt="4" mb="3">
        <Flex gap="2">
          <Skeleton width="150px" height="24px" />
          <Skeleton width="100px" height="24px" />
        </Flex>
        <Skeleton width="240px" height="32px" />
      </Flex>
      <Skeleton width="100%" height="40px" />
      <Flex direction="column" gap="2" mt="2">
        {[100, 96, 100, 92, 98].map((width, row) => (
          <Skeleton key={row} width={`${width}%`} height="44px" />
        ))}
      </Flex>
    </Container>
  )
}
