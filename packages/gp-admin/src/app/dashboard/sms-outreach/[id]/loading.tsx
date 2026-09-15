import { Container } from '@radix-ui/themes'
import { LoadingSpinner } from '@/components/LoadingSpinner'

// Vendor (Peerly) job + detailedstats reads are the slow part of this page,
// so this shows for longer than the queue's own loading.tsx.
export default function Loading() {
  return (
    <Container size="3">
      <LoadingSpinner p="9">Loading campaign…</LoadingSpinner>
    </Container>
  )
}
