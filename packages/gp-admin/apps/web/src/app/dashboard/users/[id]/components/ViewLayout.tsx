import { Container, Box, Separator } from '@radix-ui/themes'
import { stubbedUserHeader } from '@/data/stubbed-user'
import { UserPageHeader } from './UserPageHeader'
import { TabNavigation } from './TabNavigation'

interface ViewLayoutProps {
  children: React.ReactNode
  userId: string
}

export async function ViewLayout({ children, userId }: ViewLayoutProps) {
  // TODO: Replace stubbed data with API call using userId
  void userId
  const headerData = stubbedUserHeader

  return (
    <Container size="4">
      <Box mb="4">
        <UserPageHeader user={headerData} />
      </Box>

      <TabNavigation userId={userId} />

      <Separator size="4" my="4" />

      {children}
    </Container>
  )
}
