import { ForwardConfirmPage } from './ForwardConfirmPage'

export const metadata = { title: 'Confirm reply address', robots: 'noindex' }

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  return <ForwardConfirmPage token={token} />
}
