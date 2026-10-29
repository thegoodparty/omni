import { Container, Heading, Skeleton } from '@radix-ui/themes'

export default function Loading() {
  return (
    <Container size="4">
      <Heading size="6" mb="3">
        Email sends
      </Heading>
      <Skeleton width="100%" height="160px" />
    </Container>
  )
}
