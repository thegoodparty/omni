import { SignIn } from '@clerk/nextjs'
import { Metadata } from 'next'
import { Flex, Container } from '@radix-ui/themes'

export const metadata: Metadata = {
  title: 'Sign In | GP Admin',
  description: 'Sign in to your GP Admin account',
}

export default function SignInPage() {
  return (
    <Flex
      align="center"
      justify="center"
      style={{ minHeight: '100vh' }}
    >
      <Container size="1" p="8">
        <Flex direction="column" align="center" justify="center">
          <SignIn />
        </Flex>
      </Container>
    </Flex>
  )
}
