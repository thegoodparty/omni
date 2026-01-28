import { Container, Heading, Text, Box } from '@radix-ui/themes'

interface UserDetailPageProps {
  userId: string
}

export default function UserDetailPage({ userId }: UserDetailPageProps) {
  return (
    <Container size="4">
      <Heading size="6" mb="4">
        User Details
      </Heading>

      <Box p="4" className="border border-[var(--gray-5)] rounded-lg">
        <Text>User ID: {userId}</Text>
      </Box>
    </Container>
  )
}
