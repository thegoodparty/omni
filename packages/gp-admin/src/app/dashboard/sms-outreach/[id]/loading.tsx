import { Card, Container, Flex, Skeleton } from '@radix-ui/themes'

// Vendor (Peerly) job + detailedstats reads are the slow part of this page,
// so this shows for longer than the queue's own loading.tsx. Mirrors the
// review layout: title row, the message card (image + script lines), and
// the stats/details cards below.
export default function Loading() {
  return (
    <Container size="3">
      <Flex justify="between" align="center" mb="4" mt="4">
        <Flex direction="column" gap="2">
          <Skeleton width="260px" height="28px" />
          <Skeleton width="180px" height="18px" />
        </Flex>
        <Skeleton width="120px" height="24px" />
      </Flex>
      <Card mb="4">
        <Flex gap="4" p="2">
          <Skeleton width="120px" height="120px" />
          <Flex direction="column" gap="2" flexGrow="1">
            <Skeleton width="100%" height="16px" />
            <Skeleton width="95%" height="16px" />
            <Skeleton width="88%" height="16px" />
            <Skeleton width="60%" height="16px" />
            <Flex gap="3" mt="3">
              <Skeleton width="130px" height="32px" />
              <Skeleton width="130px" height="32px" />
            </Flex>
          </Flex>
        </Flex>
      </Card>
      <Flex gap="4">
        <Card style={{ flex: 1 }}>
          <Flex direction="column" gap="2" p="2">
            <Skeleton width="140px" height="18px" />
            <Skeleton width="100%" height="14px" />
            <Skeleton width="90%" height="14px" />
            <Skeleton width="95%" height="14px" />
          </Flex>
        </Card>
        <Card style={{ flex: 1 }}>
          <Flex direction="column" gap="2" p="2">
            <Skeleton width="140px" height="18px" />
            <Skeleton width="100%" height="14px" />
            <Skeleton width="85%" height="14px" />
            <Skeleton width="92%" height="14px" />
          </Flex>
        </Card>
      </Flex>
    </Container>
  )
}
