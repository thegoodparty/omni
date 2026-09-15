import { Container, Heading, Text } from '@radix-ui/themes'
import { LoadingSpinner } from '@/components/LoadingSpinner'

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
      <LoadingSpinner>Loading queue…</LoadingSpinner>
    </Container>
  )
}
