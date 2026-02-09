import { Container, Box, Separator } from '@radix-ui/themes'
import { UserPageHeader } from './UserPageHeader'
import { TabNavigation } from './TabNavigation'

export function ViewLayout({ children }: { children: React.ReactNode }) {
  return (
    <Container size="4">
      <Box mb="4">
        <UserPageHeader />
      </Box>

      <TabNavigation />

      <Separator size="4" my="4" />

      {children}
    </Container>
  )
}
