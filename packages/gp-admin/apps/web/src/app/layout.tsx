import type { Metadata } from 'next'
import './globals.css'
import { ClerkProvider } from '@clerk/nextjs'
import { SidebarProvider } from '@/shared/layout/SidebarContext'
import { Theme } from '@radix-ui/themes'
import { Header } from '@/shared/layout/Header'
import { ToastProvider } from '@/components/Toast'
import { GoodPartyClient } from '@goodparty_org/sdk'
import { generateUrl } from '@/shared/util/generateUrl.util'

const {
  GP_ADMIN_MACHINE_SECRET,
  GP_API_PROTOCOL,
  GP_API_DOMAIN,
  GP_API_PORT,
  GP_API_ROOT_PATH,
} = process.env

if (!GP_ADMIN_MACHINE_SECRET) {
  throw new Error('GP_ADMIN_MACHINE_SECRET is not set')
}

if (!GP_API_PROTOCOL) {
  throw new Error('GP_API_PROTOCOL is not set')
}

if (!GP_API_DOMAIN) {
  throw new Error('GP_API_DOMAIN is not set')
}

const gpClient = await GoodPartyClient.create({
  m2mSecret: GP_ADMIN_MACHINE_SECRET,
  gpApiRootUrl: generateUrl({
    protocol: GP_API_PROTOCOL,
    domain: GP_API_DOMAIN,
    port: GP_API_PORT,
    rootPath: GP_API_ROOT_PATH,
  }).toString(),
})

console.log(`gpClient =>`, gpClient)

const user = await gpClient.users.get(1)
console.log(`user =>`, user)

export const metadata: Metadata = {
  title: 'GP Admin',
  description: 'GP Admin Dashboard',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          <Theme accentColor="indigo" grayColor="slate" radius="large">
            <ToastProvider>
              <SidebarProvider>
                <Header />
                {children}
              </SidebarProvider>
            </ToastProvider>
          </Theme>
        </body>
      </html>
    </ClerkProvider>
  )
}
