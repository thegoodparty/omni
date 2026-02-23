import { SignIn } from '@clerk/nextjs'
import { Metadata } from 'next'
import { Box, Flex } from '@radix-ui/themes'

export const metadata: Metadata = {
  title: 'Sign In | GP Admin',
  description: 'Sign in to your GP Admin account',
}

export default function SignInPage() {
  return (
    <Flex align="center" justify="center" minHeight="calc(100vh - 64px)">
      <Box p="8">
        <Flex direction="column" align="center" justify="center">
          <SignIn fallbackRedirectUrl="/dashboard" />
        </Flex>
      </Box>
    </Flex>
  )
}
