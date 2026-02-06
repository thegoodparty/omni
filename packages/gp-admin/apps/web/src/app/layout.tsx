import type { Metadata } from 'next'
import './globals.css'
import { ClerkProvider } from '@clerk/nextjs'
import { SidebarProvider } from '@/shared/layout/SidebarContext'
import { Theme } from '@radix-ui/themes'
import { Header } from '@/shared/layout/Header'
import { clerkClient } from '@clerk/nextjs/server'
import { GoodPartyClient } from '@goodparty_org/sdk'

const gpClient = new GoodPartyClient()

console.log(`gpClient =>`, gpClient)

const getGpWebAppMachineAuthToken = async () => {
  const client = await clerkClient()

  try {
    const m2mToken = await client.m2m.createToken({
      machineSecretKey: process.env.GP_ADMIN_MACHINE_SECRET,
    })
    return m2mToken
  } catch (error) {
    console.error(error)
  }
}

const m2MToken = await getGpWebAppMachineAuthToken()

const resp = await fetch('http://localhost:3000/v1/users/1',
  {
    headers: {
      Authorization: `Bearer ${m2MToken!.token}`
    }
  })

const user = await resp.json()
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
  console.log('WTF??')
  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          <Theme accentColor="indigo" grayColor="slate" radius="large">
            <SidebarProvider>
              <Header />
              {children}
            </SidebarProvider>
          </Theme>
        </body>
      </html>
    </ClerkProvider>
  )
}
