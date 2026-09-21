import { Card, Container, Flex, Skeleton } from '@radix-ui/themes'

// Mirrors the upload page: title row, the "what this send was" card, then
// the uploader card.
export default function Loading() {
  return (
    <Container size="3">
      <Flex direction="column" gap="2" mt="4" mb="4">
        <Skeleton width="120px" height="16px" />
        <Skeleton width="280px" height="28px" />
        <Skeleton width="200px" height="16px" />
      </Flex>
      <Card mb="4">
        <Flex direction="column" gap="2" p="2">
          <Skeleton width="160px" height="18px" />
          <Skeleton width="100%" height="14px" />
          <Skeleton width="90%" height="14px" />
          <Skeleton width="95%" height="14px" />
          <Skeleton width="80%" height="14px" />
        </Flex>
      </Card>
      <Card>
        <Flex direction="column" gap="2" p="2">
          <Skeleton width="180px" height="18px" />
          <Skeleton width="100%" height="14px" />
          <Skeleton width="220px" height="32px" />
        </Flex>
      </Card>
    </Container>
  )
}
